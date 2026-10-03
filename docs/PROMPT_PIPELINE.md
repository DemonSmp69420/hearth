# Hearth — Prompt Pipeline

How a turn's payload is assembled, block by block, and what happens when it
doesn't fit. The single source of truth is `src/domain/prompt/builder.ts`
(`buildPrompt`) — this document explains it.

## Order of blocks

Each generation assembles the following blocks, in order. "Protected" blocks
are never dropped by the budget; trimmable blocks are dropped in the ladder
below.

| # | Block | Source | Protected |
|---|---|---|---|
| 1 | System prompt | The active named prompt (D-025), or the default intro | ✅ |
| 2 | Character card | description + personality + scenario (macros expanded) | ✅ |
| 3 | Group cast | Group-chat roster (group chats only) | ✅ |
| 4 | Persona | The `{{user}}` persona's role/appearance/personality/backstory/preferences | ✅ |
| 5 | Pinned memory | `memory_items` in scope (global + character + chat), enabled only | ✅ |
| 6 | Triggered lore | Lorebook entries fired by keyword/regex in recent messages | — |
| 7 | Story ledger | Open threads only (pending/active), importance-ranked, ≤ 200 tok (§9.4) | ✅ |
| 8 | Scene state | Current scene fields (`location: … · time: …`) | ✅ |
| 9 | Rolling summary | Latest summary of older history (trimmable, regenerable) | — |
| — | Advanced entries | `prompt_entries`: anchored before/after a block, or injected at depth N | locked ✅ |
| 10 | Example dialogue | The card's example dialogue | — |
| 11 | Recent history | The active path's visible messages, newest kept | — |
| 12 | Post-history | Card `post_history_instructions` | ✅ |

The system payload (blocks 1–9 + anchored entries + 12) is joined into **one
system message**; history messages follow with their roles (`narrator`
messages map to `system`).

## Macros

All text is macro-expanded **before** token estimation: `{{user}}`/`{{char}}`
(plus legacy `{user}`, `<USER>`), `{{date}}`, `{{time}}`,
`{{random:a,b,c}}`, `{{lastMessage}}`, and per-chat `{{var:name}}` values.
Unknown macros are left verbatim so typos stay visible.

## Token estimation

Heuristic (chars ÷ 3.7 + 4/message overhead) unless the provider reports real
usage, which is stored on the message after each generation. Estimates are
always labelled as estimates in the UI.

## The budget and the trim ladder

With a per-chat context limit set (Proxy panel), the budget is
`contextTokens − maxTokens`. Protected blocks that alone exceed the budget
raise a clear error instead of silently truncating. Otherwise:

1. **Oldest history messages** are dropped (newest kept) until the remainder
   fits — a single O(n) backward pass with suffix sums (M6.1).
2. **Triggered lore**, lowest priority first.
3. **Example dialogue** (whole block).
4. **Unlocked advanced entries**, lowest trim-priority first (locked entries
   never drop; entries over their own token budget were dropped up front).
5. **Rolling summary** last ("regenerate shorter" to re-fit).

Every drop is written to a **trim log** — the Inspector shows what was
removed and why, and the token meter shows the per-block cost split.
