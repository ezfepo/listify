---
name: phase-check
description: Verify the current plan.md phase is complete — run lint and tests, check the phase's checkpoint, tick finished checkboxes, then stop. Use at the end of a phase session.
disable-model-invocation: true
---

# phase-check

Closes out one phase of `plan.md` (CLAUDE.md working rule 1: one phase per session, stop at its checkpoint).

1. Read `plan.md` §5 and identify the current phase: the first phase with unchecked `- [ ]` items.
2. Run `npm run lint` and `npm test` from the repo root. Report failures verbatim; do not tick anything while either fails.
3. For each checkbox in the phase, verify it against the code (file exists, test covers it, behavior present). Do not tick on assumption.
4. Tick only verified checkboxes in `plan.md`.
5. Check the phase's checkpoint text. Report what is met and what is missing.
6. Confirm the invariants still hold:
   - nothing outside `apps/server/src/sync/apply.ts` writes to Spotify
   - nothing is removed from Main without a verified Archive copy
   - tests use fixtures, never the live Spotify API
7. Stop. Do not start the next phase. Suggest a conventional commit message.
