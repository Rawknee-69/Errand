import type { JournalVerifyResponse } from "@errand/shared";
import type { BadgeTone } from "./tone.ts";

export type JournalVerdict = {
  tone: BadgeTone;
  title: string;
  detail: string;
  brokenSeq: number | null;
};

function entries(count: number): string {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

export function journalVerdict(result: JournalVerifyResponse): JournalVerdict {
  if (result.ok) {
    return {
      tone: "ok",
      title: "Chain intact",
      detail: `${entries(result.checked)} recomputed; every hash matches.`,
      brokenSeq: null,
    };
  }
  return {
    tone: "danger",
    title: `Chain broken at sequence ${result.firstBrokenSeq}`,
    detail: `${entries(result.checked)} before it are intact. The journal was altered or an entry is missing.`,
    brokenSeq: result.firstBrokenSeq,
  };
}
