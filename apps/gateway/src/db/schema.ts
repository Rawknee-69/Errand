import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Tool classes, increasing danger; `unknown` is never allowed (GLOSSARY.md).
export type ToolClass = "read" | "write" | "send" | "delete" | "spend" | "unknown";

// Trust tiers (GLOSSARY.md): `learner` needs a human tap; `license` auto-approves within caps.
export type Tier = "learner" | "license";

// Vault auth schemes for a connector; stdio is excluded (spec).
export type ConnectorAuthType = "none" | "bearer" | "header" | "basic" | "oauth";

// Verifier outcomes per change; `unverified` never implies success (GLOSSARY.md).
export type VerificationOutcome = "matched" | "mismatched" | "unverified";

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
    transport: text("transport").notNull(),
    authType: text("auth_type").notNull().$type<ConnectorAuthType>(),
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

// OAuth 2.1 + PKCE in-flight attempts (spec: ticket P2).
export const oauthAttempts = sqliteTable(
  "oauth_attempts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    connectorId: text("connector_id").notNull().references(() => connectors.id),
    state: text("state").notNull().unique(),
    codeVerifier: text("code_verifier").notNull(),
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
    description: text("description").notNull().default(""),
    inputSchema: text("input_schema").notNull().default("{}"),
    class: text("class").notNull().default("unknown").$type<ToolClass>(),
    definitionHash: text("definition_hash").notNull(),
    requestable: integer("requestable", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("tools_user_id_idx").on(t.userId),
    uniqueIndex("tools_connector_id_name_idx").on(t.connectorId, t.name),
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
    state: text("state").notNull(),
    tier: text("tier").notNull().$type<Tier>(),
    tools: text("tools").notNull().default("[]"),
    constraints: text("constraints").notNull().default("{}"),
    callCap: integer("call_cap").notNull().default(0),
    callsUsed: integer("calls_used").notNull().default(0),
    spendCapCents: integer("spend_cap_cents").notNull().default(0),
    spendUsedCents: integer("spend_used_cents").notNull().default(0),
    capabilityHash: text("capability_hash"),
    signature: text("signature"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    approvedAt: text("approved_at"),
    burnedAt: text("burned_at"),
    burnedReason: text("burned_reason"),
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
    appliedAt: text("applied_at"),
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

// Append-only, hash-chained log of every decision and event (GLOSSARY.md).
// prev_hash of the first event is 64 zeros; seq is contiguous from 1.
export const journal = sqliteTable(
  "journal",
  {
    seq: integer("seq").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    eventType: text("event_type").notNull(),
    payload: text("payload").notNull().default("{}"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("journal_user_id_idx").on(t.userId)],
);
