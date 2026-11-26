import { z } from "zod";
import { toolClassSchema, type ToolClass, type VerificationOutcome } from "@errand/shared";
import type { ConnectorToolResult } from "../connectors/call.ts";

export type UpstreamRead = (
  tool: string,
  args: Record<string, unknown>,
) => Promise<ConnectorToolResult>;

export const inverseSchema = z.object({
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  toolClass: toolClassSchema,
});
export type Inverse = z.infer<typeof inverseSchema>;

export type Verification = {
  verification: VerificationOutcome;
  summary: string;
  inverse?: Inverse;
};

export type VerificationInput = {
  tool: string;
  arguments: Record<string, unknown>;
  result: ConnectorToolResult;
  toolClass: ToolClass;
  read: UpstreamRead;
};

export type VerifierAdapter = {
  name: string;
  matches(connectorUrl: string): boolean;
  verify(input: VerificationInput): Promise<Verification>;
};

const eventSchema = z.object({ id: z.string(), title: z.string(), start: z.string() });
const eventsSchema = z.array(eventSchema);
const contentSchema = z.array(z.object({ type: z.string(), text: z.string().optional() }));

function textOf(result: ConnectorToolResult): string {
  const parsed = contentSchema.safeParse(result.content);
  if (!parsed.success) return "";
  return parsed.data.map((item) => item.text ?? "").join("");
}

function jsonOf(result: ConnectorToolResult): unknown {
  try {
    return JSON.parse(textOf(result));
  } catch {
    return undefined;
  }
}

async function readEvents(read: UpstreamRead) {
  return eventsSchema.safeParse(jsonOf(await read("list_events", {})));
}

async function verifyCreateEvent(input: VerificationInput): Promise<Verification> {
  const created = eventSchema.safeParse(jsonOf(input.result));
  if (!created.success) {
    return {
      verification: "mismatched",
      summary: "The calendar returned a create result that could not be read.",
    };
  }
  const listed = await readEvents(input.read);
  if (!listed.success) {
    return {
      verification: "unverified",
      summary: "The event was created, but the calendar list could not be read back.",
    };
  }
  const found = listed.data.find((event) => event.id === created.data.id);
  const matches =
    found !== undefined &&
    found.title === created.data.title &&
    found.start === created.data.start;
  if (!matches) {
    return {
      verification: "mismatched",
      summary: `The calendar accepted “${created.data.title}”, but reading it back did not show it.`,
    };
  }
  return {
    verification: "matched",
    summary: `Created “${created.data.title}” and read it back from the calendar.`,
    inverse: { tool: "delete_event", arguments: { id: created.data.id }, toolClass: "delete" },
  };
}

async function verifyDeleteEvent(input: VerificationInput): Promise<Verification> {
  const deleted = z.object({ id: z.string() }).safeParse(input.arguments);
  if (!deleted.success) {
    return {
      verification: "unverified",
      summary: "The deletion ran, but its event id could not be read.",
    };
  }
  const listed = await readEvents(input.read);
  if (!listed.success) {
    return {
      verification: "unverified",
      summary: "The event was deleted, but the calendar list could not be read back.",
    };
  }
  if (listed.data.some((event) => event.id === deleted.data.id)) {
    return {
      verification: "mismatched",
      summary: `The calendar accepted the deletion of ${deleted.data.id}, but the event is still there.`,
    };
  }
  return {
    verification: "matched",
    summary: `Deleted ${deleted.data.id} and confirmed the event is gone from the calendar.`,
  };
}

const paymentLinkSchema = z.object({
  id: z.string(),
  name: z.string(),
  cents: z.number().int().nonnegative(),
  url: z.string(),
  restaurant: z.string(),
});
const paymentLinksResultSchema = z.object({
  restaurant: z.string(),
  totalCents: z.number().int().nonnegative(),
  links: z.array(paymentLinkSchema),
});
const paymentLinkListSchema = z.object({ links: z.array(paymentLinkSchema) });

async function verifyPaymentLinks(input: VerificationInput): Promise<Verification> {
  const created = paymentLinksResultSchema.safeParse(jsonOf(input.result));
  if (!created.success) {
    return {
      verification: "mismatched",
      summary: "The payment service returned links that could not be read.",
    };
  }
  const listed = paymentLinkListSchema.safeParse(
    jsonOf(await input.read("list_split_links", {})),
  );
  if (!listed.success) {
    return {
      verification: "unverified",
      summary: "The links were created, but the payment service could not be read back.",
    };
  }
  const missing = created.data.links.filter(
    (link) =>
      !listed.data.links.some(
        (stored) =>
          stored.id === link.id &&
          stored.cents === link.cents &&
          stored.name === link.name &&
          stored.restaurant === created.data.restaurant,
      ),
  );
  const listedTotal = listed.data.links
    .filter((stored) => created.data.links.some((link) => link.id === stored.id))
    .reduce((sum, stored) => sum + stored.cents, 0);
  if (missing.length > 0 || listedTotal !== created.data.totalCents) {
    return {
      verification: "mismatched",
      summary: `The payment service accepted ${created.data.links.length} split links, but reading them back did not match the restaurant, names, shares or total.`,
    };
  }
  const total = (created.data.totalCents / 100).toFixed(2);
  return {
    verification: "matched",
    summary: `Created ${created.data.links.length} split payment links for ${created.data.restaurant} totalling $${total} and read them back.`,
  };
}

const paymentAdapter: VerifierAdapter = {
  name: "mock-pay",
  matches(connectorUrl) {
    try {
      return /\/pay\/mcp$/.test(new URL(connectorUrl).pathname);
    } catch {
      return false;
    }
  },
  async verify(input) {
    if (input.tool === "create_payment_links") return verifyPaymentLinks(input);
    return {
      verification: "unverified",
      summary: `The payment service has no verifier for ${input.tool}, so this change is unverified.`,
    };
  },
};

const calendarAdapter: VerifierAdapter = {
  name: "mock-calendar",
  matches(connectorUrl) {
    try {
      return /\/calendar(?:-secure)?\/mcp$/.test(new URL(connectorUrl).pathname);
    } catch {
      return false;
    }
  },
  async verify(input) {
    if (input.tool === "create_event") return verifyCreateEvent(input);
    if (input.tool === "delete_event") return verifyDeleteEvent(input);
    return {
      verification: "unverified",
      summary: `The calendar has no verifier for ${input.tool}, so this change is unverified.`,
    };
  },
};

const adapters: VerifierAdapter[] = [calendarAdapter, paymentAdapter];

export function adapterFor(connectorUrl: string): VerifierAdapter | undefined {
  return adapters.find((adapter) => adapter.matches(connectorUrl));
}

export type VerifyChangeOptions = {
  connectorUrl: string;
  connectorName: string;
  tool: string;
  arguments: Record<string, unknown>;
  result: ConnectorToolResult;
  toolClass: ToolClass;
  read: UpstreamRead;
};

// No adapter or a failed re-read is `unverified`, never a success claim.
export async function verifyChange(options: VerifyChangeOptions): Promise<Verification> {
  const adapter = adapterFor(options.connectorUrl);
  if (adapter === undefined) {
    return {
      verification: "unverified",
      summary: `No verifier is installed for ${options.connectorName}, so this change is unverified.`,
    };
  }
  try {
    return await adapter.verify({
      tool: options.tool,
      arguments: options.arguments,
      result: options.result,
      toolClass: options.toolClass,
      read: options.read,
    });
  } catch {
    return {
      verification: "unverified",
      summary: "The change ran, but the connector could not be re-read to verify it.",
    };
  }
}
