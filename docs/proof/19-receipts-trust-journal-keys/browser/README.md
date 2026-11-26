# Browser evidence scripts

These are the scripts that produced the screenshots and console/network logs for
#19. They are evidence, not part of the build, and run only while the two proof
stacks are up.

Prerequisites:

- `bun install` (the repo's `playwright-core` devDependency launches the
  installed Chromium directly; the Playwright MCP server was unavailable because
  its configured Chrome path does not exist on this machine).
- Chromium 1255 at
  `C:/Users/Rem/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe`.
  Change `executablePath` in a script if your install differs.
- Main stack: mock services on `4133`, gateway on `8899` with
  `DATABASE_PATH=<temp>/errand-19-proof.db`, web on `5301`.
- Empty stack: a fresh gateway on `8898` and web on `5302`.
- The main database was seeded by `../drive.ts` first.

Run in this order:

```
bun 01-desktop-and-phone.ts   # walkthrough: undo, license, journal clean, keys
bun 02-phone.ts               # phone viewport screenshots
bun 03-tamper-journal.ts      # change one journal payload in the temp database
bun 04-journal-broken.ts      # broken verdict, then a 503 removes it
bun 05-empty-states.ts        # empty screens against the second stack
bun 06-error-states.ts        # deliberate 503 per store, via route interception
bun 08-loading-states.ts      # delayed responses
bun 09-capture-api.ts         # API payloads used by the screens
```

`01` covers the trust offer and the accepted license on desktop and phone, so
there is no separate trust script. The scripts use the same passphrase as
`../drive.ts` (`proof-passphrase-19`).
