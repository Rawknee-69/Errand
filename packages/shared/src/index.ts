import { z } from "zod";

export { escapeHtml } from "./html.ts";

// The control panel's Connectors screen; the gateway redirect and the web
// router share it so they cannot drift apart.
export const CONNECTORS_PATH = "/connectors";

export type Health = {
  status: "ok";
};

export type GatewayHealth = Health & {
  service: "gateway";
  version: string;
};

export type MockServicesHealth = Health & {
  service: "mock-services";
};

export const toolClassSchema = z.enum(["read", "write", "send", "delete", "spend", "unknown"]);
export type ToolClass = z.infer<typeof toolClassSchema>;

export const slipStateSchema = z.enum(["pending", "approved", "denied", "expired", "burned"]);
export type SlipState = z.infer<typeof slipStateSchema>;

export const tierSchema = z.enum(["learner", "license"]);
export type Tier = z.infer<typeof tierSchema>;

export const slipToolSchema = z.object({
  name: z.string(),
  connectorId: z.string(),
  class: toolClassSchema,
});
export type SlipTool = z.infer<typeof slipToolSchema>;

export const capTrimSchema = z.object({
  field: z.enum(["call_cap", "spend_cap_cents"]),
  requested: z.number().int(),
  applied: z.number().int(),
  reason: z.literal("human_trim"),
});
export type CapTrim = z.infer<typeof capTrimSchema>;

export const slipSummarySchema = z.object({
  slipId: z.string(),
  state: slipStateSchema,
  tier: tierSchema,
  goal: z.string(),
  errandType: z.string(),
  callCap: z.number().int(),
  callsUsed: z.number().int(),
  spendCapCents: z.number().int(),
  spendUsedCents: z.number().int(),
  trims: z.array(capTrimSchema),
  expiresAt: z.string(),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  burnedAt: z.string().nullable(),
  burnedReason: z.string().nullable(),
});
export type SlipSummary = z.infer<typeof slipSummarySchema>;

export const approvalCardSchema = z.object({
  slipId: z.string(),
  state: slipStateSchema,
  tier: tierSchema,
  goal: z.string(),
  services: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      tools: z.array(z.string()),
    }),
  ),
  can: z.array(
    z.object({
      tool: z.string(),
      label: z.string(),
      connector: z.string(),
      class: toolClassSchema,
    }),
  ),
  cannot: z.array(z.string()),
  callCap: z.number().int(),
  callsUsed: z.number().int(),
  callsRemaining: z.number().int(),
  spendCapCents: z.number().int(),
  spendUsedCents: z.number().int(),
  spendRemainingCents: z.number().int(),
  trims: z.array(capTrimSchema),
  expiresAt: z.string(),
  timeLeftSeconds: z.number().int(),
});
export type ApprovalCard = z.infer<typeof approvalCardSchema>;

export const slipApprovalInputSchema = z
  .object({
    callCap: z.number().int().positive().optional(),
    spendCapCents: z.number().int().nonnegative().optional(),
  })
  .strict();
export type SlipApprovalInput = z.infer<typeof slipApprovalInputSchema>;

export const slipDetailSchema = z.object({
  slip: slipSummarySchema,
  card: approvalCardSchema,
});
export type SlipDetail = z.infer<typeof slipDetailSchema>;

export const slipListResponseSchema = z.object({ slips: z.array(slipSummarySchema) });
export type SlipListResponse = z.infer<typeof slipListResponseSchema>;

export const slipApprovedSchema = z.object({
  slip: slipSummarySchema,
  card: approvalCardSchema,
  trims: z.array(capTrimSchema),
});
export type SlipApproved = z.infer<typeof slipApprovedSchema>;

export const verificationOutcomeSchema = z.enum(["matched", "mismatched", "unverified"]);
export type VerificationOutcome = z.infer<typeof verificationOutcomeSchema>;

export const receiptUndoSchema = z.object({
  id: z.string(),
  appliedAt: z.string().nullable(),
  verification: verificationOutcomeSchema.nullable(),
  summary: z.string().nullable(),
});
export type ReceiptUndo = z.infer<typeof receiptUndoSchema>;

export const receiptViewSchema = z.object({
  id: z.string(),
  slipId: z.string(),
  callId: z.string().nullable(),
  errandType: z.string(),
  verification: verificationOutcomeSchema,
  summary: z.string(),
  toolClass: toolClassSchema,
  irreversible: z.boolean(),
  undo: receiptUndoSchema.nullable(),
  createdAt: z.string(),
});
export type ReceiptView = z.infer<typeof receiptViewSchema>;

export const receiptListResponseSchema = z.object({ receipts: z.array(receiptViewSchema) });
export type ReceiptListResponse = z.infer<typeof receiptListResponseSchema>;

export const undoApplyResponseSchema = z.object({
  verification: verificationOutcomeSchema,
  summary: z.string(),
  receipt: receiptViewSchema,
});
export type UndoApplyResponse = z.infer<typeof undoApplyResponseSchema>;

// Sends wait out a short cancel window; spends wait for a human tap. `releasing`
// is the claimed state while the gateway is forwarding, so a second worker skips it.
export const outboxClassSchema = z.enum(["send", "spend"]);
export type OutboxClass = z.infer<typeof outboxClassSchema>;

export const outboxStateSchema = z.enum([
  "held",
  "needs_human",
  "releasing",
  "released",
  "confirmed",
  "failed",
  "cancelled",
  "expired",
]);
export type OutboxState = z.infer<typeof outboxStateSchema>;

export function isPendingOutboxState(state: OutboxState): boolean {
  return state === "held" || state === "needs_human";
}

export const outboxItemSchema = z.object({
  id: z.string(),
  slipId: z.string(),
  goal: z.string(),
  tool: z.string(),
  connectorName: z.string(),
  toolClass: outboxClassSchema,
  state: outboxStateSchema,
  amountCents: z.number().int().nonnegative(),
  releaseAt: z.string().nullable(),
  expiresAt: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type OutboxItem = z.infer<typeof outboxItemSchema>;

export const outboxListResponseSchema = z.object({ items: z.array(outboxItemSchema) });
export type OutboxListResponse = z.infer<typeof outboxListResponseSchema>;

export const outboxItemResponseSchema = z.object({ item: outboxItemSchema });
export type OutboxItemResponse = z.infer<typeof outboxItemResponseSchema>;

// Hard ceilings the gateway clamps agent requests to and the trust screen offers
// as maxima, so the form can never promise more than the agent may run.
export const AGENT_LIMITS = {
  tools: 20,
  calls: 50,
  callsPerMinute: 20,
  spendCents: 20_000,
  minutes: 30,
} as const;

// Five consecutive clean runs earn a license offer; trust is lost faster than it is gained.
export const CLEAN_RUNS_FOR_LICENSE = 5;

export const trustCapsSchema = z.object({
  callCap: z.number().int().positive(),
  spendCapCents: z.number().int().nonnegative(),
  minutes: z.number().int().positive(),
});
export type TrustCaps = z.infer<typeof trustCapsSchema>;

export const trustViewSchema = z.object({
  errandType: z.string(),
  tools: z.array(z.string()),
  tier: tierSchema,
  cleanRuns: z.number().int().nonnegative(),
  licenseOffered: z.boolean(),
  caps: trustCapsSchema.nullable(),
  updatedAt: z.string(),
});
export type TrustView = z.infer<typeof trustViewSchema>;

export const trustListResponseSchema = z.object({ trust: z.array(trustViewSchema) });
export type TrustListResponse = z.infer<typeof trustListResponseSchema>;

export const licenseAcceptResponseSchema = z.object({ trust: trustViewSchema });
export type LicenseAcceptResponse = z.infer<typeof licenseAcceptResponseSchema>;

export const feedPayloadSchema = z.record(z.string(), z.unknown());

export const feedEventSchema = z.object({
  seq: z.number().int().positive(),
  eventType: z.string(),
  createdAt: z.string(),
  payload: feedPayloadSchema,
});
export type FeedEvent = z.infer<typeof feedEventSchema>;

export const limitClampSchema = z.object({
  field: z.enum(["calls", "spend_cents", "minutes"]),
  requested: z.number().int(),
  applied: z.number().int(),
  reason: z.literal("server_maximum"),
});
export type LimitClamp = z.infer<typeof limitClampSchema>;

// Danger order shared by the gateway's policy and the control panel. `unknown`
// ranks below every runnable class because it blocks the tool outright.
export const toolClassRank: Record<ToolClass, number> = {
  unknown: 0,
  read: 1,
  write: 2,
  send: 3,
  delete: 4,
  spend: 5,
};

export function isClassLoosening(from: ToolClass, to: ToolClass): boolean {
  return toolClassRank[to] > toolClassRank[from];
}

export const toolStateSchema = z.enum(["new", "active", "changed", "removed"]);
export type ToolState = z.infer<typeof toolStateSchema>;

export function isBlockedToolState(state: ToolState): boolean {
  return state === "changed" || state === "removed";
}

// Exposure is the human's requestable choice, but a blocked definition never
// reaches the agent even if that choice was on.
export function isToolExposed(tool: { requestable: boolean; state: ToolState }): boolean {
  return tool.requestable && !isBlockedToolState(tool.state);
}

export const connectorAuthTypeSchema = z.enum(["none", "bearer", "header", "basic", "oauth"]);
export type ConnectorAuthType = z.infer<typeof connectorAuthTypeSchema>;

export const connectorAuthStatusSchema = z.enum(["active", "pending", "needs_reauth"]);
export type ConnectorAuthStatus = z.infer<typeof connectorAuthStatusSchema>;
export const CONNECTOR_AUTH_STATUSES = connectorAuthStatusSchema.options;

export const mcpTransportSchema = z.enum(["streamable-http", "sse"]);
export type McpTransportKind = z.infer<typeof mcpTransportSchema>;

export const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const sessionViewSchema = z.object({
  authenticated: z.boolean(),
  demoMode: z.boolean(),
  user: authUserSchema.nullable(),
});
export type SessionView = z.infer<typeof sessionViewSchema>;

export const loginRequestSchema = z
  .object({
    passphrase: z.string().min(1).max(512).optional(),
    demoUser: z.string().min(1).max(60).optional(),
  })
  .refine((value) => (value.passphrase === undefined) !== (value.demoUser === undefined), {
    message: "Provide exactly one of passphrase or demoUser",
  });
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const agentKeyViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
});
export type AgentKeyView = z.infer<typeof agentKeyViewSchema>;

export const agentKeyCreatedSchema = z.object({
  key: z.string(),
  agentKey: agentKeyViewSchema,
  mcpUrl: z.string(),
});
export type AgentKeyCreated = z.infer<typeof agentKeyCreatedSchema>;

export const agentKeyListResponseSchema = z.object({ agentKeys: z.array(agentKeyViewSchema) });
export type AgentKeyListResponse = z.infer<typeof agentKeyListResponseSchema>;

export const agentKeyResponseSchema = z.object({ agentKey: agentKeyViewSchema });
export type AgentKeyResponse = z.infer<typeof agentKeyResponseSchema>;

// The journal check is a discriminated verdict: a clean chain has no broken
// sequence, a broken one always names the first.
export const journalVerifyResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), checked: z.number().int().nonnegative() }),
  z.object({
    ok: z.literal(false),
    checked: z.number().int().nonnegative(),
    firstBrokenSeq: z.number().int().positive(),
  }),
]);
export type JournalVerifyResponse = z.infer<typeof journalVerifyResponseSchema>;

export const authHintSchema = z.enum(["bearer", "basic", "header", "oauth"]);
export type AuthHint = z.infer<typeof authHintSchema>;

export const probeResultSchema = z.object({
  reachable: z.boolean(),
  transport: mcpTransportSchema.nullable(),
  requiresAuth: z.boolean(),
  authHint: authHintSchema.nullable(),
  toolCount: z.number().int().nonnegative(),
});
export type ProbeResult = z.infer<typeof probeResultSchema>;

export const connectorViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  transport: mcpTransportSchema,
  authType: connectorAuthTypeSchema,
  authStatus: connectorAuthStatusSchema,
  lastAuthError: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConnectorView = z.infer<typeof connectorViewSchema>;

export const oauthStartResponseSchema = z.object({
  connector: connectorViewSchema,
  authorizationUrl: z.url(),
});
export type OAuthStartResponse = z.infer<typeof oauthStartResponseSchema>;

export const ingestSummarySchema = z.object({
  new: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type IngestSummary = z.infer<typeof ingestSummarySchema>;

export const catalogToolViewSchema = z.object({
  id: z.string(),
  connectorId: z.string(),
  name: z.string(),
  agentName: z.string(),
  description: z.string(),
  inputSchema: z.string(),
  annotations: z.string(),
  class: toolClassSchema,
  definitionHash: z.string(),
  observedDescription: z.string(),
  observedInputSchema: z.string(),
  observedAnnotations: z.string(),
  observedClass: toolClassSchema,
  observedHash: z.string(),
  state: toolStateSchema,
  requestable: z.boolean(),
  changedAt: z.string().nullable(),
  removedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CatalogToolView = z.infer<typeof catalogToolViewSchema>;

export const connectorDetailSchema = z.object({
  connector: connectorViewSchema,
  transport: mcpTransportSchema,
  summary: ingestSummarySchema,
  tools: z.array(catalogToolViewSchema),
});
export type ConnectorDetail = z.infer<typeof connectorDetailSchema>;

export const catalogResponseSchema = z.object({
  tools: z.array(catalogToolViewSchema),
  connectors: z.array(connectorViewSchema),
});
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;

export const catalogToolResponseSchema = z.object({ tool: catalogToolViewSchema });
export type CatalogToolResponse = z.infer<typeof catalogToolResponseSchema>;

export const toolClassUpdateSchema = z.object({
  class: toolClassSchema,
  confirm: z.boolean().default(false),
});

export const toolRequestableUpdateSchema = z.object({
  requestable: z.boolean(),
});

export const connectorReauthResponseSchema = z.object({
  connector: connectorViewSchema,
  authorizationUrl: z.string(),
});
export type ConnectorReauthResponse = z.infer<typeof connectorReauthResponseSchema>;

export const headerNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9-]+$/, "Header names may only contain letters, digits and hyphens")
  .refine(
    (name) =>
      !["host", "content-length", "connection", "transfer-encoding", "authorization"].includes(
        name.toLowerCase(),
      ),
    { message: "That header is managed by the gateway" },
  );

const connectorBase = {
  name: z.string().min(1).max(120),
  url: z.string().min(1),
};

export const connectorAuthInputSchema = z.discriminatedUnion("authType", [
  z.object({ ...connectorBase, authType: z.literal("none") }),
  z.object({ ...connectorBase, authType: z.literal("bearer"), token: z.string().min(1) }),
  z.object({
    ...connectorBase,
    authType: z.literal("header"),
    headerName: headerNameSchema,
    headerValue: z.string().min(1),
  }),
  z.object({
    ...connectorBase,
    authType: z.literal("basic"),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
]);
export type ConnectorAuthInput = z.infer<typeof connectorAuthInputSchema>;

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const agentCatalogToolSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  class: toolClassSchema,
  connector: z.string(),
});
export type AgentCatalogTool = z.infer<typeof agentCatalogToolSchema>;

export const hiddenToolReasonSchema = z.enum([
  "not_requestable",
  "definition_changed",
  "definition_removed",
  "decoy",
]);
export type HiddenToolReason = z.infer<typeof hiddenToolReasonSchema>;

export const hiddenToolSchema = z.object({
  name: z.string(),
  label: z.string(),
  connector: z.string(),
  class: toolClassSchema,
  reason: hiddenToolReasonSchema,
});
export type HiddenTool = z.infer<typeof hiddenToolSchema>;

export const boundaryConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  authStatus: connectorAuthStatusSchema,
  discovered: z.number().int().nonnegative(),
  visible: z.number().int().nonnegative(),
});
export type BoundaryConnector = z.infer<typeof boundaryConnectorSchema>;

export const boundaryCountsSchema = z.object({
  connectors: z.number().int().nonnegative(),
  discovered: z.number().int().nonnegative(),
  visible: z.number().int().nonnegative(),
  hidden: z.number().int().nonnegative(),
  decoys: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  notRequestable: z.number().int().nonnegative(),
});
export type BoundaryCounts = z.infer<typeof boundaryCountsSchema>;

export const boundaryLimitsSchema = z.object({
  tools: z.number().int().positive(),
  calls: z.number().int().positive(),
  callsPerMinute: z.number().int().positive(),
  spendCents: z.number().int().nonnegative(),
  minutes: z.number().int().positive(),
});
export type BoundaryLimits = z.infer<typeof boundaryLimitsSchema>;

export const boundarySchema = z.object({
  connectors: z.array(boundaryConnectorSchema),
  visible: z.array(agentCatalogToolSchema),
  hidden: z.array(hiddenToolSchema),
  counts: boundaryCountsSchema,
  limits: boundaryLimitsSchema,
});
export type Boundary = z.infer<typeof boundarySchema>;

export const journalVerifySchema = z.union([
  z.object({ ok: z.literal(true), checked: z.number().int().nonnegative() }),
  z.object({
    ok: z.literal(false),
    checked: z.number().int().nonnegative(),
    firstBrokenSeq: z.number().int().positive(),
  }),
]);
export type JournalVerify = z.infer<typeof journalVerifySchema>;
