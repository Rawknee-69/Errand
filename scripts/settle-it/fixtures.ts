import { Client } from "@modelcontextprotocol/client";
import { z } from "zod";
import {
  agentKeyCreatedSchema,
  catalogResponseSchema,
  catalogToolResponseSchema,
  connectorDetailSchema,
  connectorViewSchema,
} from "../../packages/shared/src/index.ts";
import {
  FRIEND_CALENDARS,
  MOCK_AUTH,
  MOCK_PATHS,
} from "../../apps/mock-services/src/server.ts";
import { connectAgent } from "../../apps/gateway/tests/agent/mcp-client.ts";
import { HumanApi, type AuthInput } from "./api.ts";

export type SettleFriend = {
  name: string;
  api: HumanApi;
  agent: Client;
};

export type SettleFixtures = {
  owner: { api: HumanApi; agent: Client };
  friends: SettleFriend[];
};

const connectorListSchema = z.object({ connectors: z.array(connectorViewSchema) });

async function ensureConnector(
  api: HumanApi,
  name: string,
  url: string,
  auth: AuthInput,
  exposure: Record<string, boolean>,
): Promise<string> {
  const listed = await api.json(connectorListSchema, "/api/connectors");
  const existing = listed.connectors.find((connector) => connector.url === url);
  const connector =
    existing ??
    (
      await api.json(connectorDetailSchema, "/api/connectors", {
        method: "POST",
        body: { name, url, ...auth },
      })
    ).connector;

  const catalog = await api.json(catalogResponseSchema, "/api/catalog");
  for (const tool of catalog.tools.filter((row) => row.connectorId === connector.id)) {
    const requestable = exposure[tool.name] ?? false;
    if (tool.requestable === requestable) continue;
    await api.json(catalogToolResponseSchema, `/api/catalog/${tool.id}/requestable`, {
      method: "POST",
      body: { requestable },
    });
  }
  return connector.id;
}

async function issueAgentKey(api: HumanApi, name: string): Promise<Client> {
  const issued = await api.json(agentKeyCreatedSchema, "/api/agent-keys", {
    method: "POST",
    body: { name },
  });
  return connectAgent(api.base, issued.key);
}

function atMock(base: string, path: string): string {
  return new URL(path, base).toString();
}

export async function seedSettleFixtures(
  base: string,
  mock: string,
  passphrase: string,
): Promise<SettleFixtures> {
  const ownerApi = await HumanApi.loginOwner(base, passphrase);
  const ownerCalendarUrl = atMock(mock, MOCK_PATHS.calendarSecure);
  await ensureConnector(
    ownerApi,
    "Calendar",
    ownerCalendarUrl,
    { authType: "bearer", token: MOCK_AUTH.calendarBearer },
    { list_events: true, create_event: true, delete_event: false },
  );
  await ensureConnector(
    ownerApi,
    "Dine out",
    atMock(mock, MOCK_PATHS.dineOutSse),
    { authType: "basic", username: MOCK_AUTH.dineOutUser, password: MOCK_AUTH.dineOutPassword },
    {
      search_restaurants: true,
      reserve_table: false,
      place_order: false,
      cancel_reservation: false,
    },
  );
  await ensureConnector(
    ownerApi,
    "Pay",
    atMock(mock, MOCK_PATHS.pay),
    { authType: "header", headerName: MOCK_AUTH.payHeaderName, headerValue: MOCK_AUTH.payHeaderValue },
    {
      create_payment_links: true,
      list_split_links: true,
      charge_card: false,
      refund_payment: false,
      send_receipt: false,
      get_balance: false,
    },
  );
  await ensureConnector(
    ownerApi,
    "Email",
    atMock(mock, MOCK_PATHS.email),
    { authType: "bearer", token: MOCK_AUTH.emailBearer },
    { list_messages: true, send_email: false },
  );
  const ownerAgent = await issueAgentKey(ownerApi, "Settle It coordinator");

  const friends: SettleFriend[] = [];
  for (const [name, calendar] of Object.entries(FRIEND_CALENDARS)) {
    const api = await HumanApi.loginFriend(base, name);
    await ensureConnector(
      api,
      "Calendar",
      ownerCalendarUrl,
      { authType: "bearer", token: calendar.token },
      { list_events: true, create_event: false, delete_event: false },
    );
    const agent = await issueAgentKey(api, `Settle It ${name}`);
    friends.push({ name, api, agent });
  }

  return { owner: { api: ownerApi, agent: ownerAgent }, friends };
}
