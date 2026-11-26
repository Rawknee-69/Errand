# Ticket #3 â€” P1 Â· Schema plus hash-chained journal

## Files built

- `apps/gateway/src/db/schema.ts` â€” Drizzle SQLite schema for all 12 tables.
- `apps/gateway/drizzle/0000_lonely_the_spike.sql` (+ `meta/`) â€” generated migrations.
- `apps/gateway/drizzle.config.ts` â€” drizzle-kit config.
- `apps/gateway/src/db/client.ts` â€” `createMigratedDatabase`, `runMigrations`, `Db`.
- `apps/gateway/src/db/journal.ts` â€” `appendJournalEvent`, `verifyJournal`, `canonicalJson`, scoped journal reads.
- `apps/gateway/src/db/scoped-reads.ts` â€” one home for per-user scoped reads.
- `apps/gateway/src/app.ts` â€” `GET /api/journal/verify`.
- `apps/gateway/src/config.ts`, `src/index.ts` â€” `DATABASE_PATH`, boot migration.
- Tests: `tests/db/schema.test.ts`, `tests/db/journal.test.ts`, `tests/db/scoped.test.ts`, `tests/journal-api.test.ts`.
- `.env.example`, `docs/VERSIONS.md` updated.

## Commands run

```
bun run typecheck
bun test
bunx drizzle-kit generate
bun run src/index.ts        # then curl /health and /api/journal/verify
```

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
âœ“ 3 checks passed: comments, installed, no-any

$ bun test
bun test v1.4.4 (38afee6c8)
 24 pass
 0 fail
 73 expect() calls
Ran 24 tests across 8 files.
```

## Proof

Command transcript with the negative case (tamper â†’ verify reports the seq),
a real client against the running gateway, browser screens, and the suite:

- docs/proof/03-schema-journal/logs/journal-transcript.txt
- docs/proof/03-schema-journal/logs/api-journal-verify.txt
- docs/proof/03-schema-journal/logs/server.txt
- docs/proof/03-schema-journal/logs/test-output.txt
- docs/proof/03-schema-journal/logs/typecheck.txt
- docs/proof/03-schema-journal/screens/01-health.png
- docs/proof/03-schema-journal/screens/02-journal-verify-clean.png

Verdict: pass (see docs/proof/03-schema-journal/PROOF.md).

## Versions changed

- `drizzle-orm` 0.45.4 (latest), `drizzle-kit` 0.31.11 (latest, dev) â€” recorded in `docs/VERSIONS.md`.

## Unverified / notes

- Trailing-event truncation is not detected by an internal hash chain; no criterion asks for an external head anchor.
- No per-user journal UI is driven (arrives P7); scoping is proven at the query layer by the scoped-read tests.

## Review

`/code-review` run (Standards + Spec axes), findings addressed in-branch:
drizzle-kit installed, `firstBrokenSeq` reported against expected position and
verify ordered by immutable `id`, scoped reads extracted to one helper,
comment/`unknown`/unused-export fixes.
