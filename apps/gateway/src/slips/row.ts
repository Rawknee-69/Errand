import type { slips } from "../db/schema.ts";

export type SlipRow = typeof slips.$inferSelect;
