import { describe, expect, test } from "bun:test";
import { slips } from "../../src/db/schema.ts";
import { buildApprovalCard } from "../../src/slips/card.ts";
import { seedConnector, seedTool, TS, userDb } from "../agent/support.ts";

const NOW = new Date("2026-04-01T12:00:00.000Z");

function seededSlip() {
  const db = userDb();
  seedConnector(db, "user-a", "conn-cal", "Calendar");
  seedTool(db, "user-a", {
    id: "tool-list",
    connectorId: "conn-cal",
    name: "list_events",
    agentName: "calendar__list_events",
  });
  seedConnector(db, "user-a", "conn-notion", "Notion");
  seedTool(db, "user-a", {
    id: "tool-create",
    connectorId: "conn-notion",
    name: "create_page",
    agentName: "notion__create_page",
    class: "write",
  });
  db.insert(slips)
    .values({
      id: "slip-1",
      userId: "user-a",
      errandType: "type-1",
      goal: "Book a dinner",
      state: "pending",
      tier: "learner",
      tools: JSON.stringify([
        { name: "calendar__list_events", connectorId: "conn-cal", class: "read" },
        { name: "notion__create_page", connectorId: "conn-notion", class: "write" },
      ]),
      callCap: 8,
      spendCapCents: 1250,
      expiresAt: "2026-04-01T12:30:00.000Z",
      createdAt: TS,
      updatedAt: TS,
    })
    .run();
  return db;
}

describe("approval card", () => {
  test("states the goal, services and what the agent can and cannot do", () => {
    const db = seededSlip();
    const card = buildApprovalCard(
      db,
      "user-a",
      {
        id: "slip-1",
        state: "pending",
        tier: "learner",
        goal: "Book a dinner",
        trims: "[]",
        tools: JSON.stringify([
          { name: "calendar__list_events", connectorId: "conn-cal", class: "read" },
          { name: "notion__create_page", connectorId: "conn-notion", class: "write" },
        ]),
        callCap: 8,
        callsUsed: 0,
        spendCapCents: 1250,
        spendUsedCents: 0,
        expiresAt: "2026-04-01T12:30:00.000Z",
      },
      NOW,
    );

    expect(card).toMatchObject({
      slipId: "slip-1",
      state: "pending",
      tier: "learner",
      goal: "Book a dinner",
      services: [
        { id: "conn-cal", name: "Calendar", tools: ["calendar__list_events"] },
        { id: "conn-notion", name: "Notion", tools: ["notion__create_page"] },
      ],
      can: [
        { tool: "calendar__list_events", label: "Calendar: list events", class: "read", connector: "Calendar" },
        { tool: "notion__create_page", label: "Notion: create page", class: "write", connector: "Notion" },
      ],
      callCap: 8,
      callsRemaining: 8,
      spendCapCents: 1250,
      spendRemainingCents: 1250,
      timeLeftSeconds: 1800,
      trims: [],
    });

    expect(card.cannot).toEqual(
      expect.arrayContaining([
        "Use any tool that is not on this slip",
        "Run after the slip expires",
        "Make more than 8 calls",
        "Delete anything",
        "Send messages or email",
        "Spend any money",
      ]),
    );
    expect(card.cannot).not.toContain("Change anything");
  });

  test("a slip with call and spend allowances states the money limit", () => {
    const db = userDb();
    seedConnector(db, "user-a", "conn-shop", "Shop");
    seedTool(db, "user-a", {
      id: "tool-buy",
      connectorId: "conn-shop",
      name: "buy_item",
      agentName: "shop__buy_item",
      class: "spend",
    });
    const card = buildApprovalCard(
      db,
      "user-a",
      {
        id: "slip-1",
        state: "pending",
        tier: "learner",
        goal: "Buy one thing",
        trims: "[]",
        tools: JSON.stringify([{ name: "shop__buy_item", connectorId: "conn-shop", class: "spend" }]),
        callCap: 1,
        callsUsed: 0,
        spendCapCents: 2500,
        spendUsedCents: 0,
        expiresAt: "2026-04-01T12:30:00.000Z",
      },
      NOW,
    );

    expect(card.cannot).toContain("Make more than 1 call");
    expect(card.cannot).toContain("Spend more than $25.00");
    expect(card.cannot).not.toContain("Spend any money");
  });
});
