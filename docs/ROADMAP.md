# Hearth — Roadmap

**Status:** v0.1 draft for team review (pre-M0) · 2026-10-03
Sizes are **ideal dev-days for one senior engineer**; wall-clock ≈ ×1.5–2 with review/demo/fixup. Every milestone ends in a **runnable app + passing tests + a CHANGELOG entry + short demo notes/screens** (spec §16). Never sacrifice a P1 to start a P3.

## At a glance

| Milestone | Focus | Est. | Cumulative |
|---|---|---|---|
| M0 Foundations | shell, theme engine, DB, adapter interface, CI | 7 d | 1.5 wk |
| M1 Chat MVP | providers, proxies, characters, personas, tree chat, formatting | 21.5 d | 6 wk |
| M2 Prompt pipeline & memory | builder, budgeter, inspector, memory panel, lore, summaries, prompt entries + presets | 16 d | 9 wk |
| M3 Story Ledger & Director | heuristics, sidecar, folding, ledger UI, scene state | 11 d | **11 wk (all P1s done)** |
| M4 Polish & power | branch map, search, themes+, prompt manager, companion server, import/export, backups, usage | 20 d | 15 wk |
| M5 Extras | compare, group chats, privacy tools, phone-responsive pass, writing aids, … | 13.5 d | 17.5 wk |
| M6 Hardening | perf, a11y, packaging, docs | 8.5 d | ~19.5 wk |

**P1 critical path = M0–M3 ≈ 11 weeks.** M1's Rust adapters and UI work parallelize cleanly for two people. Detailed flags behind any deviation live in `ARCHITECTURE.md` §2 and `DECISIONS.md`.

---

## M0 — Foundations (7.5 d)
*Spec §15: app launches, theme switches live, DB migrates.*

| ID | Task | Spec | Size |
|---|---|---|---|
| M0.1 | Repo scaffold: pnpm + Vite + strict TS + ESLint/Prettier + Tauri 2 init; GitHub Actions matrix (win/mac/linux: lint, typecheck, test, build) | §14 | 1.5 |
| M0.2 | DB layer: tauri-plugin-sql, WAL bootstrap, migration runner (versioned SQL files + `schema_migrations` + pre-migration file backup), schema v1 (ARCHITECTURE §6.2 core tables) | §5 | 1.5 |
| M0.3 | **Spike: FTS5 + recursive CTEs + triggers in plugin's bundled SQLite** → go/no-go on F3 fallback (rusqlite layer). Timeboxed 1 d | §3 | 0.5–1 |
| M0.4 | Theme engine: material-color-utilities → CSS role vars, light/dark/system, 3 presets, M3 type scale; navigation rail shell + list-detail scaffolding + settings page skeleton | §11 | 2 |
| M0.5 | Provider adapter interface (TS types + Rust trait) + **mock provider** (echo/stream/error scripts) for offline dev; keychain commands (set/get/delete) | §4, §10 | 1 |
| M0.6 | Test harness: Vitest + Playwright-with-mocked-IPC; first domain tests (uuidv7, settings kv); ESLint domain-boundary rule | §14 | 1 |
| M0.7 | Transport abstraction: `invoke/listen` interface with tauri + mock impls (http impl arrives with M4.11); all UI wired through it (F18/D-021) | §4.1 | 0.5 |

**Exit:** fresh install migrates cleanly (and from a seeded older schema); theme mode toggles live; mock chat round-trips a streamed message through the real IPC path; CI green on 3 OSes.
**Demo:** 60-second shell tour + `PRAGMA journal_mode` screenshot for the skeptics.

---

## M1 — Chat MVP (21.5 d)
*Spec §15: full conversation with branching and redo against a real provider, keys in keychain.*

**Rust workstream (7 d):**

| ID | Task | Spec | Size |
|---|---|---|---|
| M1.1 | OpenAI-compatible adapter: SSE stream, cancel, usage parse, retry/backoff, error surfacing; usage_log writes | §10 | 2.5 |
| M1.2 | Anthropic adapter (assistant-prefill capability flag → Continue, F8) | §10 | 1.5 |
| M1.3 | Gemini adapter (`alt=sse`) | §10 | 1.5 |
| M1.4 | Provider convenience presets (OpenRouter, Ollama, LM Studio, KoboldCpp base URLs — F4) + PNG card chunk IO (`tEXt chara`/`ccv3`) + WebP thumbnails | §6.1, §10 | 1.5 |

**Domain workstream (5.5 d):**

| ID | Task | Spec | Size |
|---|---|---|---|
| M1.5 | Tree ops full suite + tests: insert/leaf/swipes/sibling `ord`/branch/fork/soft-delete/path CTE/single-writer queue | §5 | 2 |
| M1.6 | Macro engine (all spec macros + custom vars) + tests | §6.1 | 1 |
| M1.7 | Streaming state machine: idle/streaming/stopped/error/interrupted; partial persistence (400ms batches); crash recovery marks `interrupted` | §6.3, §14 | 1.5 |
| M1.8 | Token estimator interface (heuristic + provider-reported) | §3 | 1 |

**UI workstream (7.5 d):**

| ID | Task | Spec | Size |
|---|---|---|---|
| M1.9 | Chat view: virtualized message list, roleplay markdown renderer (sanitized; `*action*` italic, `"dialogue"` accent, `(OOC)` dim), composer with send/stop, message footer (model/tokens/latency) | §6.3, §6.4 | 2.5 |
| M1.10 | Message actions: inline edit (in place / as branch), delete, hide, pin, bookmark, swipes `‹2/5›`, redo (+ steering line, model/preset redo; keep-vs-discard setting), impersonate, branch/fork; undo snackbars | §6.3 | 2.5 |
| M1.11 | Character library + editor: all card fields, avatar crop, gallery, tags/folders/favorites/search/sort; greetings seed root siblings (D-007) | §6.1 | 2 |
| M1.12 | Card V2/V3 import/export (JSON + PNG); personas CRUD + chat-header quick switch | §6.1, §6.2 | 1.5 |
| M1.13 | Provider settings UI: profiles, keychain key entry, test connection w/ diagnostics, model list fetch + manual entry, sampler/params presets, model slots (main/utility) | §10 | 1.5 |
| M1.14 | Chat list/home: recents, "continue where you left off", new-chat flow with greeting picker | §12 | 0.5 |
| M1.15 | Proxy profiles: table + keychain-stored credentials, per-provider attach + global default, reqwest client wiring (socks/socks5h, env-vars-off default), test-via-proxy diagnostics, palette quick-switch (F16) | §10 | 1.5 |

**Exit:** real key in keychain → streamed chat vs OpenAI-compatible + Anthropic + Gemini; proxy-attached traffic routes through the chosen proxy with diagnostics confirming the hop; swipe/edit/branch/fork/redo all work; branch switch instantly changes visible history; crash mid-stream recovers as `interrupted` with Continue offered; card round-trip PNG⇄editor.
**Demo:** script covering one branch-heavy conversation + import a community card.

---

## M2 — Prompt pipeline & memory (16 d)
*Spec §15: 500-message chat stays in budget; Inspector explains every block.*

| ID | Task | Spec | Size |
|---|---|---|---|
| M2.1 | PromptBuilder: 12-block assembly, per-block budgets, template renderer (chat-completion kind) | §6.5 | 2.5 |
| M2.2 | TokenBudgeter trim ladder + trim log; js-tiktoken lazy integration | §6.5 | 1.5 |
| M2.3 | Token meter in composer (segmented by block) | §6.5 | 1 |
| M2.4 | **Generation manifest** writes (F6) + Prompt Inspector (as-generated + what-would-send-now, per-block tokens, trims, lore/memory/threads included) | §6.5 | 2 |
| M2.5 | Memory items (persona/pinned, scopes, importance, enable/pin) + Memory Panel with live injected-view + token costs | §7 | 2 |
| M2.6 | Lorebooks basic: entries, keywords/regex, constant, priority, position, scan depth, probability; attachments global/character/persona/chat; trigger engine + tests | §8 | 2 |
| M2.7 | Rolling summaries: chunking, anchoring, edit/regenerate/"summarize now", branch-lazy regeneration with caching | §7 | 2 |
| M2.8 | Suggestions storage + inbox UI (Save/Edit/Dismiss); AI population arrives with M3 Director (F7) | §7 | 1 |
| M2.9 | i18n scaffold: typed dictionaries + `t()` sweep over shipped strings (F12) | §14 | 0.5 |
| M2.10 | Prompt entries model + builder/inspector integration: scoped entries (global/character/chat), roles, block anchoring + depth injection, branch-aware timed effects, trim_priority/lock; author's note reimplemented as built-in entry (F17) | §6.5 | 1.5 |
| M2.11 | Prompt presets: save current prompt config as named presets (system prompt + entries + budgets + template), duplicate/rename/delete/set-default, built-in seeds, per-chat override + chat-header quick-switch, JSON export/import (§8.7, D-020) | §6.5 | 1.5 |

**Exit:** 500-message synthetic chat assembles under budget with a documented trim log; Inspector explains every block and matches the wire payload byte-for-byte (fixture test); lore firing visible per turn; custom entries assemble at their anchor/depth with correct timing; named presets save/restore/switch from the chat header.

---

## M3 — Story Ledger & Director (11 d)
*Spec §15: the four §9.5 acceptance tests pass.*

| ID | Task | Spec | Size |
|---|---|---|---|
| M3.1 | Heuristics gate: pattern list (editable), keyword resolution watch, path-aware safety net (detector_run events), zero-call guarantee | §9.3 | 1.5 |
| M3.2 | Director runner: minimal-context sidecar call on utility slot, zod-validated JSON contract, retry-once, combined threads+scene+memory payload | §9.3 | 2 |
| M3.3 | Fold engine completion + memoization: ledger fold, scene fold, run-lull; branch purity property tests | §5, §9.1 | 1.5 |
| M3.4 | Ledger injection block: open-threads-only, 200-tok cap, importance→relevance→recency ranking, optional recently-resolved | §9.4 | 0.5 |
| M3.5 | Ledger UI: tab in Memory sheet, filter chips, thread cards (origin/resolution jump links, evidence), manual status buttons, edit/merge/delete/pin | §9.5 | 2 |
| M3.6 | Inline chips on messages ("Thread added/fulfilled") + snackbar undo; suggestions inbox goes live | §9.5, §7 | 1 |
| M3.7 | Scene state: user-defined fields, fold, HUD above composer, compact injection | §12 | 1 |
| M3.8 | Per-chat ledger settings (on/off, mode, sensitivity, auto-accept threshold, utility model) + inline & manual modes | §9.3 | 0.5 |
| M3.9 | Acceptance tests 1–4 (spec §9.5) as CI tests with mock utility model | §9.5 | 1 |

**Exit:** all four acceptance tests green in CI; promise still in prompt after 150 messages; branch-before-creation removes thread; no-commitment chat shows **zero** sidecar calls in usage_log.
**Demo:** the bridge-promise script, including the branch switch flip.

---

## M4 — Polish & power (20 d)

| ID | Task | Spec | Size |
|---|---|---|---|
| M4.1 ✅ | Branch Map: canvas tree renderer with LOD/collapsed subtrees, jump-to-node, labels/colors, prune dead branches (soft delete + undo) | §6.3 | 3 |
| M4.2 ✅ | Command palette (Ctrl/Cmd+K): jump chats/characters, actions, theme/model switch; keyboard shortcuts help dialog | §11.1 | 1.5 |
| M4.3 ✅ | Global search: FTS5 UI with filters (character, date, branch, bookmarked) | §11.1 | 1.5 |
| M4.4 ✅ | Theming full: 8 presets, creator with live preview + JSON export/import, AMOLED, contrast levels, avatar-seeded per-chat themes — *creator preview/export/import + character-derived per-chat accent shipped (deterministic name hash; toggle in the Proxy panel)* | §11.2 | 2.5 |
| M4.5 ✅ | Chat styles: bubbles/flat/compact; reading settings (font, size, line-height, width, density, avatar size); typewriter pacing | §6.4 | 1.5 |
| M4.6 ✅ | Organization: chat folders/tags/pin/archive; character folders (if not landed in M1) — *chat pin/archive/folders/tags shipped; character folders remain open* | §12 | 1 |
| M4.7 ✅ | Import/export suite: Card V3 polish, SillyTavern chat logs (swipes→siblings mapping doc), chat export MD/JSON/TXT — *SillyTavern JSONL import + chat export MD/TXT/JSON/ST-JSONL via native save/open dialogs shipped; card polish remains* | §12 | 2.5 |
| M4.8 ✅ | Backups: scheduled `VACUUM INTO` + zip + rotation (F14), integrity check, full library export/import (secrets excluded) — *scheduled VACUUM INTO + timestamped rotation + Back up now shipped; zip bundling and full library export/import remain* | §12, §14 | 1.5 |
| M4.9 ✅ | Usage dashboard: tokens/est. spend by provider/model/chat/day, split by purpose — *totals, 14-day bars, per-provider and per-chat tables shipped; spend estimates and purpose split remain* | §10 | 1.5 |
| M4.10 ✅ | Advanced Prompt Manager UI: drag-reorder entry list, enable/lock toggles, role/anchor/depth/timing editors, per-scope layers, live preview against the Prompt Inspector (F17) — *manager with drag + arrow reorder, anchor/depth/timing/budget/trim editors, builder integration with tests shipped; Inspector live-preview tie-in remains* | §6.5 | 2 |
| M4.11 ✅ | Companion web server: axum embedded in the Rust process (settings toggle, default off; optional `--server` headless mode), serves built UI over LAN, invoke bridge to the shared command registry, WebSocket event stream, per-device pairing-token auth with QR + revocable sessions, `http` transport impl in the client (F18) — *shipped 2026-10-03; headless `--server` mode deferred* | §4.1 | 3 |

**Exit:** every P1 from §12 search/backups/org shipped; demo tour of palette, map, search, themes.
*M4 status (2026-10-03): all tasks functionally shipped — leftovers are sub-scope refinements (card polish, zip bundles, library export, spend estimates, character folders, Inspector tie-in) tracked for M5 polish.*

---

## M5 — Extras (13.5 d, ordered by value; trim from the bottom if time-pressed)

| ID | Task | Spec | Size |
|---|---|---|---|
| M5.1 ✅ | Compare mode (parallel candidates, pick one) — *shipped: ×2–×4 parallel streaming, all candidates kept as sibling swipes, picked one becomes the active leaf* | §6.3 | 1.5 |
| M5.2 ✅ | Group chats: `chat_members` migration, turn order (manual/round-robin/auto), @mention, per-character color/mute — *shipped: cast bar (mute/remove/add), roster block in the prompt (protected), speaker names in history + per-speaker color/labels/avatars, round-robin cursor, auto @Name detection, manual Speak chips, group-aware Compare + Regenerate + Continue* | §6.3 | 3 |
| M5.3 ✅ | Privacy tools: app lock (PIN), panic/boss key, blur-until-hover, title/thumbnail hiding — *shipped: PBKDF2 PIN lock gating the whole app on launch (also protects the phone web client), Lock now, panic key Ctrl+Shift+H (instant window hide, optional lock), blur-until-hover for messages + chat title, neutral “Notes” window title* | §12 | 2 |
| M5.4 ✅ | Chapters/scene breaks + auto chapter summaries + "Previously on…" recap (cached) — *shipped: chapters table (migration 0006) anchored at messages, branch-aware dividers in the chat, "Start a new chapter here" in the message menu, per-chapter AI summaries (utility model), "Previously on…" recap in Memory, auto-summarize of the closed chapter* | §6.3 | 1.5 |
| M5.5 ✅ | Writing aids: rewrite tools (shorter/longer/more descriptive/fix grammar), rewrite-my-message — *shipped: RewriteRow chips in the composer draft and in the message edit box, utility-model rewrites replacing text in place* | §6.3, §12 | 1 |
| M5.6 ✅ | Output rules (find/replace on in/out, per-character scope) + OOC scratchpad channel — *shipped: ordered regex/plain rules stored per chat (chats.settings), applied to AI output on finish (speaker-scoped) and to user text on send, rule manager in Proxy; OOC toggle in the composer keeps italic dimmed notes that never reach the prompt* | §6.5, §12 | 1 |
| M5.7 ✅ | "Next beat" suggestion chips (off by default, utility model) — *shipped: per-chat toggle in Proxy, 3 italic chips above the composer (tap = add to draft, ↻ = refresh), auto-refresh after each completed reply and on chat open* | §6.3 | 0.5 |
| M5.8 ✅ | Statistics page — *shipped: Stats tab with library totals, tokens sent/received, 14-day token bar chart, per-purpose usage table, longest-chats table (read-only SQL aggregates over messages/usage_log)* | §12 | 1 |
| M5.9 ✅ | Consistency guard — *shipped: zero-token deterministic scan of each finished reply against pinned memory facts (subject + negation-cue heuristic, pure + unit-tested), in-chat warning strip with per-fact detail and Dismiss, per-chat toggle in Proxy, "Check consistency now" in Memory* | §12 | 1.5 |
| M5.12 ✅ | Phone-responsive pass for the companion web client: rail→bottom-bar at narrow widths, composer ergonomics, touch targets ≥ 44px, streaming perf on mobile webview (F18) — *shipped: 560px breakpoint turns the rail into a safe-area-aware bottom bar, full-screen sheets, 44px touch targets on coarse pointers, tap-delay removal, viewport-fit=cover; the message list was already virtualized for long chats* | §4.1 | 1.5 |
| M5.10 | Character card version history | §6.1 | (stretch) |
| M5.11 | TTS / expression sprites / extension API | §12 | (stretch, P3) |

---

## M6 — Hardening (8.5 d)

| ID | Task | Size |
|---|---|---|
| M6.1 | Perf pass against the 10k-message synthetic chat (startup, scroll, fold, CTE, streaming); fix to targets in ARCHITECTURE §15 | 2 |
| M6.2 | Accessibility audit: keyboard-only walkthrough of every core flow, focus visibility, ARIA, screen-reader pass on chat + panels | 2 |
| M6.3 | Packaging: Windows installer + portable; macOS/Linux builds; updater plumbing (unsigned decision per Q1) | 2 |
| M6.4 | Docs complete: README, PROMPT_PIPELINE.md, LEDGER.md, THEMING.md, CHANGELOG sweep | 2 |
| M6.5 | i18n audit (no hardcoded strings), final QA checklist | 0.5 |

---

## Continuous practices (all milestones)
- Small commits, `main` always runnable; CHANGELOG entry per milestone including spec deviations.
- New decisions → `DECISIONS.md` the day they're made.
- Each milestone demo = screens + 5-line notes (spec §16).
- Explicitly **not yet in scope** (parking lot): TTS, image-gen hooks, extension API, semantic retrieval default-on, DB encryption — revisit after M5.
