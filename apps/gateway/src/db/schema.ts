import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { DEFAULT_CALL_RATE_PER_MINUTE } from "../policy/rate.ts";
import {
  CONNECTOR_AUTH_STATUSES,
  type ConnectorAuthStatus,
  type ConnectorAuthType,
  type McpTransportKind,
  type OutboxClass,
  type OutboxState,
  type SlipState,
  type Tier,
  type ToolClass,
  type ToolState,
  type VerificationOutcome,
} from "@errand/shared";

export { CONNECTOR_AUTH_STATUSES };
export type {
  ConnectorAuthStatus,
  ConnectorAuthType,
  OutboxClass,
  OutboxState,
  SlipState,
  Tier,
  ToolClass,
  ToolState,
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const agentKeys = sqliteTable(
  "agent_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    // SHA-256 of the key; the key itself (errand_<base64url>) is shown once, never stored.
    keyHash: text("key_hash").notNull().unique(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (t) => [index("agent_keys_user_id_idx").on(t.userId)],
);

export const connectors = sqliteTable(
  "connectors",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    url: text("url").notNull(),
    transport: text("transport").notNull().$type<McpTransportKind>(),
    authType: text("auth_type").notNull().$type<ConnectorAuthType>(),
    authStatus: text("auth_status").notNull().default("active").$type<ConnectorAuthStatus>(),
    // Short, secret-free reason for the last authorization failure.
    lastAuthError: text("last_auth_error"),
    lastSuccessAt: text("last_success_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("connectors_user_id_idx").on(t.userId)],
);

// Credentials live only here, envelope-encrypted; only the vault module decrypts (GLOSSARY.md).
// credential id + service id are the additional authenticated data (spec).
export const credentials = sqliteTable(
  "credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    connectorId: text("connector_id").references(() => connectors.id),
    serviceId: text("service_id").notNull(),
    kind: text("kind").notNull(),
    ciphertext: text("ciphertext").notNull(),
    nonce: text("nonce").notNull(),
    authTag: text("auth_tag").notNull(),
    wrappedDataKey: text("wrapped_data_key").notNull(),
    keyId: text("key_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("credentials_user_id_idx").on(t.userId), index("credentials_service_id_idx").on(t.serviceId)],
);

// OAuth 2.1 + PKCE in-flight attempts (spec: ticket P2). The verifier and
// discovery state live in the Vault under `oauth_attempt:<id>`, never here.
export const oauthAttempts = sqliteTable(
  "oauth_attempts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    connectorId: text("connector_id").notNull().references(() => connectors.id),
    state: text("state").notNull().unique(),
    redirectUri: text("redirect_uri").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
  },
  (t) => [index("oauth_attempts_user_id_idx").on(t.userId)],
);

// Catalog entries discovered across every connector, classified and pinned by definition hash (GLOSSARY.md).
export const tools = sqliteTable(
  "tools",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    connectorId: text("connector_id").notNull().references(() => connectors.id),
    name: text("name").notNull(),
    // What the agent sees: `<connector>__<tool>`, sanitised and unique per user.
    agentName: text("agent_name").notNull().default(""),
    // Pinned definition: exactly what the human saw and approved.
    description: text("description").notNull().default(""),
    inputSchema: text("input_schema").notNull().default("{}"),
    annotations: text("annotations").notNull().default("{}"),
    class: text("class").notNull().default("unknown").$type<ToolClass>(),
    // A human-set class outlives refresh and re-approval; null means classifier-owned.
    classOverride: text("class_override").$type<ToolClass>(),
    // The hash the human saw and approved; observedHash follows the upstream definition.
    definitionHash: text("definition_hash").notNull(),
    observedDescription: text("observed_description").notNull().default(""),
    observedInputSchema: text("observed_input_schema").notNull().default("{}"),
    observedAnnotations: text("observed_annotations").notNull().default("{}"),
    observedClass: text("observed_class").notNull().default("unknown").$type<ToolClass>(),
    observedHash: text("observed_hash").notNull().default(""),
    state: text("state").notNull().default("new").$type<ToolState>(),
    requestable: integer("requestable", { mode: "boolean" }).notNull().default(false),
    changedAt: text("changed_at"),
    removedAt: text("removed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("tools_user_id_idx").on(t.userId),
    uniqueIndex("tools_connector_id_name_idx").on(t.connectorId, t.name),
    uniqueIndex("tools_user_id_agent_name_idx").on(t.userId, t.agentName),
  ],
);

// Signed permission document for one errand (GLOSSARY.md); HMAC-signed canonical contents.
export const slips = sqliteTable(
  "slips",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    errandType: text("errand_type").notNull(),
    goal: text("goal").notNull().default(""),
    state: text("state").notNull().$type<SlipState>(),
    tier: text("tier").notNull().$type<Tier>(),
    tools: text("tools").notNull().default("[]"),
    constraints: text("constraints").notNull().default("{}"),
    trims: text("trims").notNull().default("[]"),
    callCap: integer("call_cap").notNull().default(0),
    callsUsed: integer("calls_used").notNull().default(0),
    // Server ceiling on calls per rolling minute; not agent-adjustable.
    rateCap: integer("rate_cap").notNull().default(DEFAULT_CALL_RATE_PER_MINUTE),
    rateWindowStartedAt: text("rate_window_started_at"),
    rateWindowCalls: integer("rate_window_calls").notNull().default(0),
    spendCapCents: integer("spend_cap_cents").notNull().default(0),
    spendUsedCents: integer("spend_used_cents").notNull().default(0),
    // Out-of-scope attempts against this slip; the second one burns it.
    scopeViolations: integer("scope_violations").notNull().default(0),
    capabilityHash: text("capability_hash"),
    signature: text("signature"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    approvedAt: text("approved_at"),
    burnedAt: text("burned_at"),
    burnedReason: text("burned_reason"),
    // Set once when the run ends (cap reached or expired) and its trust effect is applied.
    settledAt: text("settled_at"),
  },
  (t) => [index("slips_user_id_idx").on(t.userId)],
);

export const calls = sqliteTable(
  "calls",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    slipId: text("slip_id").notNull().references(() => slips.id),
    connectorId: text("connector_id").notNull().references(() => connectors.id),
    tool: text("tool").notNull(),
    arguments: text("arguments").notNull().default("{}"),
    result: text("result"),
    error: text("error"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("calls_user_id_idx").on(t.userId), index("calls_slip_id_idx").on(t.slipId)],
);

// A send held for a short cancel window, or a spend waiting for the human tap.
// `expires_at` is the point after which it is too late to run at all.
export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    slipId: text("slip_id").notNull().references(() => slips.id),
    connectorId: text("connector_id").notNull().references(() => connectors.id),
    tool: text("tool").notNull(),
    toolClass: text("tool_class").notNull().$type<OutboxClass>(),
    arguments: text("arguments").notNull().default("{}"),
    // The capability the agent presented; release re-checks it before forwarding.
    capability: text("capability").notNull(),
    amountCents: integer("amount_cents").notNull().default(0),
    state: text("state").notNull().$type<OutboxState>(),
    releaseAt: text("release_at"),
    expiresAt: text("expires_at").notNull(),
    callId: text("call_id").references(() => calls.id),
    reason: text("reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("outbox_user_id_idx").on(t.userId),
    index("outbox_state_release_at_idx").on(t.state, t.releaseAt),
  ],
);

// Human-readable result of an errand; never claims verification it did not perform (GLOSSARY.md).
export const receipts = sqliteTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    slipId: text("slip_id").notNull().references(() => slips.id),
    callId: text("call_id").references(() => calls.id),
    errandType: text("errand_type").notNull(),
    verification: text("verification").notNull().$type<VerificationOutcome>(),
    toolClass: text("tool_class").notNull().default("unknown").$type<ToolClass>(),
    irreversible: integer("irreversible", { mode: "boolean" }).notNull().default(false),
    summary: text("summary").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("receipts_user_id_idx").on(t.userId)],
);

// Undo where a real inverse exists; irreversible actions have no row here (GLOSSARY.md).
export const undoActions = sqliteTable(
  "undo_actions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    receiptId: text("receipt_id").references(() => receipts.id),
    callId: text("call_id").references(() => calls.id),
    inverse: text("inverse").notNull(),
    startedAt: text("started_at"),
    appliedAt: text("applied_at"),
    verification: text("verification").$type<VerificationOutcome>(),
    summary: text("summary"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("undo_actions_user_id_idx").on(t.userId)],
);

// Trust ledger per errand type; trust is earned, bounded and demoted (spec P8).
export const trust = sqliteTable(
  "trust",
  {
    userId: text("user_id").notNull().references(() => users.id),
    errandType: text("errand_type").notNull(),
    tier: text("tier").notNull().$type<Tier>(),
    cleanRuns: integer("clean_runs").notNull().default(0),
    caps: text("caps").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.errandType] })],
);

// Append-only, hash-chained log (GLOSSARY.md); ordered by immutable `id`, chained by `seq`.
export const journal = sqliteTable(
  "journal",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seq: integer("seq").notNull().unique(),
    userId: text("user_id").notNull().references(() => users.id),
    eventType: text("event_type").notNull(),
    payload: text("payload").notNull().default("{}"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("journal_user_id_idx").on(t.userId)],
);
