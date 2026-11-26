import { toolClassRank, type ToolClass } from "@errand/shared";

export type { ToolClass };

export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type ClassifiableTool = {
  name: string;
  annotations?: ToolAnnotations | undefined;
};

const verbs: Array<[ToolClass, readonly string[]]> = [
  [
    "spend",
    [
      "pay",
      "payment",
      "payments",
      "charge",
      "purchase",
      "buy",
      "order",
      "checkout",
      "transfer",
      "trade",
      "refund",
      "price",
      "prices",
      "invoice",
      "subscription",
      "donate",
    ],
  ],
  [
    "delete",
    [
      "delete",
      "remove",
      "destroy",
      "purge",
      "cancel",
      "revoke",
      "drop",
      "clear",
      "erase",
      "unlink",
      "trash",
      "discard",
    ],
  ],
  [
    "send",
    [
      "send",
      "email",
      "message",
      "notify",
      "notification",
      "post",
      "publish",
      "share",
      "invite",
      "comment",
      "reply",
      "forward",
      "broadcast",
      "sms",
      "text",
    ],
  ],
  [
    "write",
    [
      "create",
      "update",
      "edit",
      "set",
      "add",
      "put",
      "patch",
      "move",
      "rename",
      "schedule",
      "book",
      "reserve",
      "upload",
      "write",
      "insert",
      "append",
      "assign",
      "mark",
      "archive",
      "restore",
      "save",
    ],
  ],
  [
    "read",
    [
      "list",
      "get",
      "search",
      "find",
      "fetch",
      "read",
      "view",
      "show",
      "query",
      "count",
      "check",
      "describe",
      "retrieve",
      "lookup",
      "browse",
      "inspect",
      "status",
      "info",
    ],
  ],
];

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

function heuristicClass(name: string): ToolClass | undefined {
  const words = new Set(nameWords(name));
  for (const [toolClass, matches] of verbs) {
    if (matches.some((match) => words.has(match))) return toolClass;
  }
  return undefined;
}

function annotationClass(annotations: ToolAnnotations | undefined): ToolClass | undefined {
  if (annotations === undefined) return undefined;
  if (annotations.destructiveHint === true) return "delete";
  if (annotations.readOnlyHint === true) return "read";
  if (annotations.readOnlyHint === false) return "write";
  return undefined;
}

export function moreDangerous(left: ToolClass, right: ToolClass): ToolClass {
  if (left === "unknown") return right;
  if (right === "unknown") return left;
  return toolClassRank[left] >= toolClassRank[right] ? left : right;
}

// Annotations first, then name heuristics. A disagreement resolves to the
// more dangerous class, and no match at all is `unknown`, which never runs.
export function classifyTool(tool: ClassifiableTool): ToolClass {
  const fromAnnotations = annotationClass(tool.annotations);
  const fromName = heuristicClass(tool.name);
  if (fromAnnotations === undefined && fromName === undefined) return "unknown";
  if (fromAnnotations === undefined) return fromName ?? "unknown";
  if (fromName === undefined) return fromAnnotations;
  return moreDangerous(fromAnnotations, fromName);
}

export function defaultRequestable(toolClass: ToolClass): boolean {
  return toolClass === "read" || toolClass === "write";
}
