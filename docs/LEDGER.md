# Hearth — Story Ledger

The ledger is Hearth's long-term story memory: a quest-style log of
commitments, promises, appointments, mysteries, debts, threats, and secrets
that stays correct across hundreds of messages **and across branches**, at a
token cost capped at ~200 per turn. Implementation: `src/domain/ledger/`,
UI in the Memory sheet's **Story ledger** section.

## Model

- A **thread** is created by a `thread_create` event anchored to a message.
  Everything that happens later (status changes, evidence, resolution) is a
  further event — the ledger is append-only, never mutated.
- The current state is a **fold of events along the active path** (path
  position, then sequence). Branch from before a promise was made and the
  thread genuinely does not exist on that branch; switch back and it is
  restored. Same path in, same state out — purity is unit-tested.
- Display ids (`T1`, `T2`, …) are derived from creation order along the path.
- Scene state (`location`, `time`, …) rides the same event stream
  (`scene_set`), so it is branch-aware too.

## Detection pipeline (cheap → expensive)

1. **Gate (zero tokens).** After each send, a local heuristic checks the new
   message for commitment phrases ("I'll…", "meet me at…", "you must…"),
   mentions of any open thread's keywords (a possible resolution), and a
   safety net (15 messages since the last run). No trigger → **no AI call**;
   a normal chat costs nothing extra.
2. **Director (one cheap call).** When the gate fires, the **utility model**
   receives only the last few messages plus the compact open-thread list and
   replies with a strict JSON diff: `new_threads` (≤ 2), `updates` (status +
   evidence), `scene` fields, and `memory_suggestions`. Parse failure →
   silent retry, then give up — chat is never interrupted.
3. **Injection.** Open threads only, one line each, ranked by importance →
   keyword relevance to recent messages → recency, under a hard 200-token
   cap. Fulfilled/failed threads are never injected.

New AI-proposed threads land as `suggested` unless their confidence clears
the per-chat auto-accept threshold (Proxy panel), in which case they are
immediately `pending`. Suggestions appear in the Memory sheet for
Save / Dismiss. Manual creation is always available ("Add a thread
manually").

## Turning it off

The Memory sheet's **Threads & quests enabled** switch is a true master
switch per chat: off means no injection into the AI, no Director calls, and
no inline chips — nothing is deleted, so re-enabling restores the picture.

## Acceptance tests (all in CI — `src/domain/ledger/fold.test.ts`)

1. A promise survives 150 filler messages and is still injected, within cap.
2. Mentioning an open thread's keyword fires a resolution check.
3. Branching from before a thread's creation removes it; switching back
   restores it (fold purity).
4. A chat with no commitments triggers **zero** Director calls.
