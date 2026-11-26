// Proof driver for ticket #7: a real HTTP client against the running gateway.
// Gateway on :8788, mock services on :4002, started by the commands in
// PROOF.md. The "approve" step is the same form the consent page submits.
const gw = "http://127.0.0.1:8788";
const mock = "http://127.0.0.1:4002";
const redirect = "http://127.0.0.1:8788/api/oauth/callback";

const show = (label, value) => {
  console.log(`\n### ${label}`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
};

async function send(method, url, body, contentType = "application/json") {
  const init = { method, redirect: "manual" };
  if (body !== undefined) {
    init.headers = { "content-type": contentType };
    init.body = body;
  }
  const response = await fetch(url, init);
  const text = await response.text();
  return { status: response.status, text, location: response.headers.get("location") };
}

async function startOAuth(name) {
  const response = await send(
    "POST",
    `${gw}/api/connectors/oauth/start`,
    JSON.stringify({ name, url: `${mock}/oauth/mcp` }),
  );
  const started = JSON.parse(response.text);
  show(`start ${name} (HTTP ${response.status})`, started);
  return started;
}

async function approve(authorizationUrl) {
  const consent = await send("GET", authorizationUrl);
  show(
    `consent page (HTTP ${consent.status})`,
    consent.text.slice(0, 320),
  );
  const query = authorizationUrl.slice(authorizationUrl.indexOf("?") + 1);
  const approved = await send("POST", `${mock}/oauth/authorize`, query, "application/x-www-form-urlencoded");
  show(`authorization redirect (HTTP ${approved.status})`, approved.location);
  return approved.location;
}

const mockState = async () => JSON.parse((await send("GET", `${mock}/mock/oauth/state`)).text);
const control = (path, body) => send("POST", `${mock}${path}`, JSON.stringify(body));
const connector = async (id) => JSON.parse((await send("GET", `${gw}/api/connectors/${id}`)).text).connector;

// ---- flow 1: authorize, catalogue, refresh, rotate, invalid_grant ----------
const one = await startOAuth("Proof calendar");
const oneLocation = await approve(one.authorizationUrl);
const oneCallback = await send("GET", oneLocation);
const oneBody = JSON.parse(oneCallback.text);
show(`callback result (HTTP ${oneCallback.status})`, {
  connectorId: oneBody.connector.id,
  authStatus: oneBody.connector.authStatus,
  transport: oneBody.transport,
  summary: oneBody.summary,
  tools: oneBody.tools.map((tool) => `${tool.agentName} [${tool.class}]`),
});

show("journal verify", (await send("GET", `${gw}/api/journal/verify`)).text);

const refreshUrl = `${gw}/api/connectors/${oneBody.connector.id}/refresh`;
const firstRefresh = await send("POST", refreshUrl, "{}");
show(`refresh 1 (HTTP ${firstRefresh.status})`, JSON.parse(firstRefresh.text).connector);
show("mock state after refresh 1", await mockState());

const concurrent = await Promise.all([send("POST", refreshUrl, "{}"), send("POST", refreshUrl, "{}")]);
show("concurrent refresh statuses", concurrent.map((result) => result.status));
show("mock state after concurrent refresh", await mockState());

await control("/mock/oauth/revoke", { refreshTokens: true });
const invalidGrant = await send("POST", refreshUrl, "{}");
show(`refresh after refresh-token revocation (HTTP ${invalidGrant.status})`, invalidGrant.text);
show("connector after invalid_grant", await connector(oneBody.connector.id));
show("mock state after invalid_grant", await mockState());
show(`second refresh while needs_reauth (HTTP ${(await send("POST", refreshUrl, "{}")).status})`, "no further grant is attempted");

// ---- flow 2: repeated 401 after a successful refresh -----------------------
const two = await startOAuth("Proof calendar 401");
const twoLocation = await approve(two.authorizationUrl);
const twoBody = JSON.parse((await send("GET", twoLocation)).text);
show("second connector", { connectorId: twoBody.connector.id, authStatus: twoBody.connector.authStatus });
await control("/mock/oauth/always-401", { value: true });
const always = await send("POST", `${gw}/api/connectors/${twoBody.connector.id}/refresh`, "{}");
show(`refresh with upstream always 401 (HTTP ${always.status})`, always.text);
show("connector after repeated 401", await connector(twoBody.connector.id));
await control("/mock/oauth/always-401", { value: false });

// ---- flow 3: issuer mismatch and state replay ------------------------------
const three = await startOAuth("Proof calendar issuer");
const threeLocation = await approve(three.authorizationUrl);
const tampered = threeLocation.replace(/iss=[^&]*/, "iss=https%3A%2F%2Fevil.example");
const mismatch = await send("GET", tampered);
show(`issuer-mismatched callback (HTTP ${mismatch.status})`, mismatch.text);

const four = await startOAuth("Proof calendar replay");
const fourLocation = await approve(four.authorizationUrl);
const firstUse = await send("GET", fourLocation);
const secondUse = await send("GET", fourLocation);
show("callback first use / replay", {
  first: firstUse.status,
  replay: secondUse.status,
  replayBody: secondUse.text,
});

// ---- leave one uncompleted attempt for the storage scan --------------------
const pending = await startOAuth("Proof calendar pending");
show("pending attempt left for the TTL scan", {
  attemptId: pending.attemptId,
  authStatus: pending.connector.authStatus,
});

// ---- final reads -----------------------------------------------------------
const catalog = JSON.parse((await send("GET", `${gw}/api/catalog`)).text);
show(
  "catalog connector statuses",
  catalog.connectors.map((row) => ({
    name: row.name,
    authType: row.authType,
    authStatus: row.authStatus,
    lastAuthError: row.lastAuthError,
  })),
);
show("journal verify", (await send("GET", `${gw}/api/journal/verify`)).text);
show("redirect URI used", redirect);
