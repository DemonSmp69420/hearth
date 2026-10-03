# Changelog

All notable changes to Hearth are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.8.0] — M6 Hardening (2026-10-03)

### Performance (M6.1)
- **Two real engine bugs found and fixed by a new 10k-message soak test**
  (`src/domain/perf/soak.test.ts`, runs in CI):
  - The budget trim walk recomputed the kept-history sum on every dropped
    message — O(n²), 2.8s to assemble a prompt from a 10k-message history.
    Replaced with suffix sums and a single O(n) backward pass; identical trim
    semantics (all prompt/ledger tests unchanged).
  - `expandMacros` evaluated two `Intl` locale formatters **eagerly on every
    call** (1.9s per 10k messages) even when no date/time macro was present.
    Now lazy + cached, with a no-macro fast path that skips all regex scans.
- Measured after the fix: path walk 8ms, ledger fold 9ms, prompt assembly
  under 250ms, sibling queries 48ms at 10k messages.

### Accessibility (M6.2)
- **WCAG AA contrast enforced by test** (`src/theme/contrast.test.ts`): all
  8 presets × light/dark/AMOLED, 11 text pairs ≥ 4.5:1 and UI-boundary pairs
  ≥ 3:1 (24 tests).
- Side sheets (Proxy, Inspector, Memory) now close on **Escape**, take focus
  on open, and restore focus on close (`useSheetA11y`).
- Skip-to-content link and a focusable `<main>` landmark.

### Packaging (M6.3)
- Release pipeline verified end-to-end (`npm run tauri build`): Windows
  portable `hearth.exe` (≈ 14 MB) and `Hearth_0.7.0_x64_en-US.msi` installer
  (5.8 MB) in `src-tauri/target/release/bundle/msi/`. The alternative NSIS
  installer downloads its toolkit from GitHub on first build, which timed
  out repeatedly on this connection — run `npm run tauri build` again on a
  stable connection to produce it (the MSI covers Windows installs).
  macOS/Linux checks run in the CI matrix; local bundling is Windows-first.
  Code signing intentionally deferred (docs decision Q1 — unsigned with
  instructions).

### Docs (M6.4)
- New: `docs/PROMPT_PIPELINE.md` (block order, budgets, trim ladder),
  `docs/LEDGER.md` (event model, gate → Director pipeline, acceptance
  tests), `docs/THEMING.md` (token generation, AA guarantee),
  `docs/I18N.md` (externalization status + sweep recipe),
  `docs/QA_CHECKLIST.md` (manual release checklist). README rewritten for
  the full feature set.

### i18n (M6.5)
- Typed dictionary scaffold (`src/i18n/en.ts`, `t(key, vars?)`) with the
  shell/navigation migrated as the pattern; remaining hardcoded strings
  inventoried per file in `docs/I18N.md`.

## [0.7.0] — M5 Extras (2026-10-03)

### Added
- **Compare mode (M5.1)** — generate ×2–×4 replies in parallel from the
  composer, view them side by side, and pick one; every finished candidate is
  kept as a sibling swipe so nothing is lost.
- **Group chats (M5.2)** — add cast members to any chat (migration `0005`).
  One member replies per turn: round-robin with a persisted cursor, auto mode
  with leading `@Name` mention detection, or manual "Who speaks next" chips.
  The prompt carries a protected cast roster and speaker-prefixed history;
  replies show per-speaker names, colors, and avatars. Compare, Regenerate,
  and Continue are all group-aware.
- **Privacy tools (M5.3)** — optional PIN app lock (PBKDF2-SHA256 in
  WebCrypto; only the salted hash is stored, never the PIN); full-screen lock
  gate on launch with a **Lock now** action; panic key `Ctrl+Shift+H` that
  instantly hides the desktop window (and optionally locks); blur-until-hover
  for message content; neutral "Notes" window title.
- **Chapters & recap (M5.4)** — mark "Start a new chapter here" from any
  message (migration `0006`); branch-aware chapter dividers appear in the
  chat only while the anchor is on the active path. Per-chapter AI summaries
  via the utility model, auto-summarize of the closed chapter, and a
  "Previously on…" recap view in Memory.
- **Writing aids (M5.5)** — rewrite chips (Shorter / Longer / Vivid /
  Grammar) in the composer draft and the message edit box; results replace
  the text in place.
- **Output rules (M5.6)** — ordered find/replace (plain or regex) rewrites
  stored per chat: apply to AI output on finish (optionally scoped to one
  speaker) or to your own text on send; managed in the Proxy panel. Plus an
  **OOC scratchpad** mode in the composer: italic dimmed notes that are kept
  in the chat but never sent to the model.
- **Next-beat suggestions (M5.7)** — optional per-chat chips above the
  composer suggesting three short next actions (utility model, best-effort);
  tap to add to the draft, refresh button, auto-refresh after each reply.
- **Statistics page (M5.8)** — new Stats tab: library totals, tokens
  sent/received, a 14-day token bar chart, per-purpose usage, and longest
  chats.
- **Consistency guard (M5.9)** — zero-token scan of every finished reply
  against pinned memory facts (subject + negation-cue heuristic, fully unit
  tested); warnings surface as a dismissible in-chat strip. Per-chat toggle
  in Proxy, manual re-check in Memory.
- **Phone-responsive companion (M5.12)** — below 560px the nav rail becomes a
  safe-area-aware bottom bar, sheets go full-screen, and all controls meet
  44px touch-target sizing on coarse pointers.

## [0.6.0] — M4 Polish & power (2026-10-03)

### Added
- **Branch Map (M4.1)** — SVG tree of the whole conversation: click any node
  to jump there, prune dead branches (soft delete with undo), pan/zoom,
  permanent prune behind a confirm.
- **Command palette (M4.2)** — `Ctrl/Cmd+K` to jump to chats/characters or
  run actions (theme switch, new chat, search); `?` opens the shortcuts
  dialog.
- **Global search (M4.3)** — FTS5 across every message with filters
  (character, role, bookmarked-only, date); results deep-link into chats.
- **Theming (M4.4)** — theme creator with live Light/Dark preview and JSON
  export/import; new **character accent**: each chat can tint its buttons
  and highlights with a color derived from the character's name (toggle in
  the chat Proxy panel).
- **Reading settings (M4.5)** — chat styles (bubbles / flat / compact), font
  choice, text size, line height, column width, avatar size, and typewriter
  pacing for streaming replies. All persisted app-wide.
- **Chat organization (M4.6)** — pin, archive, folders (create/delete/move),
  tags, and rename from the chat list; All/Pinned/Archived tabs plus a
  folder filter. Migration `0003` adds chat `tags`.
- **Import/export (M4.7)** — export any chat as Markdown, plain text,
  lossless Hearth JSON, or SillyTavern JSONL via native save dialogs;
  import SillyTavern chat logs and Hearth backups with auto-detection
  (browser/companion fallback: download + file picker). New `files`
  service + `save_text_file`/`open_text_file` Rust commands (rfd).
- **Backups (M4.8)** — scheduled `VACUUM INTO` snapshots in a `backups`
  folder with oldest-first rotation (F14); interval and retention
  configurable in Settings, plus a manual **Back up now**. A background
  Rust scheduler checks every 30 minutes. Migration `0004` adds entry
  `sort`.
- **Usage dashboard (M4.9)** — Home page card with lifetime token totals,
  a 14-day bar chart, per-provider breakdown, and top chats by usage.
- **Advanced prompt manager (M4.10)** — full manager UI for prompt entries
  (F17): drag-reorder (with arrow-key fallback), enable/lock, anchor
  before/after any block or inject at depth N, timing (always / once /
  every N turns), token budget, trim priority, and global/per-character
  scopes. The builder now splices entries into the system message and
  injects depth entries into the wire, with branch-correct timing and
  trim-ladder integration — 8 new unit tests.

### Fixed
- Prompt builder protected-budget check now counts only *locked* entries as
  hard requirements; unlocked entries trim through the ladder instead of
  erroring the build.

## [0.5.0] — M4.11 Companion web server (2026-10-03)

### Added
- **Companion web server (F18/D-021)** — the desktop app can now serve its
  own UI over the home network: Settings → Companion → Start server, then
  open the shown `http://<lan-ip>:8770` on a phone and pair with the
  one-time token (or scan the QR). The phone becomes a remote control for
  the same brain — same SQLite, same keychain, same providers. No cloud,
  no accounts.
  - Rust (`src-tauri/src/server.rs`): axum server with pairing-token →
    bearer-session auth (sessions persisted in `settings`), command bridge
    (`db_select`/`db_execute`, `provider_stream`/`provider_cancel`,
    `provider_test`/`provider_list_models`, `secrets_set`/`secrets_delete`),
    WebSocket event fanout for generation streams, static UI served from
    embedded assets (prod) or `../dist` (dev) with the companion flag
    injected, boot auto-start when enabled in Settings.
  - Client (`src/services/transport/http.ts`): fetch invoke + shared
    auto-reconnect WebSocket with sub/unsub by topic; pairing gate UI
    (`PairingGate`); companion Settings section with start/stop, port,
    pairing token + QR, session list with revoke, auto-start toggle.
  - **Security boundary (D-021):** `secrets_get` is refused over the web
    client — API keys never leave the desktop; the phone sees a blank key
    field and saving with it blank keeps the stored key.
- **M3 exit verification passed on the real desktop app** (mock provider →
  chat → streaming with token accounting → regenerate swipe ‹2/2› → memory
  sheet): unblocks the milestone previously held open by the capability bug.

### Fixed
- **Desktop SQL was silently broken since M0**: `sql:default` in the Tauri
  capability file grants no permissions in tauri-plugin-sql 2.5, so every
  database read returned empty and every write failed with
  `sql.execute not allowed`. Explicit `sql:allow-*` permissions restored
  persistence. (This was the "Chats tab crashing" report — the app was
  denying every query, not crashing.)

## [0.4.0] — M3 Story Ledger & Director (2026-10-03, in progress)

### Added
- **Story ledger domain** (`src/domain/ledger/`): branch-aware event fold
  (`foldLedger` — threads + scene state derived only from events anchored on
  the active path, purity-tested), display ids (T1…), zero-token **heuristics
  gate** (commitment patterns, open-thread keyword watch, path-aware safety
  net; user-editable patterns), **token-capped injection** (open threads
  only, importance → keyword relevance → recency, 200-tok hard cap), and the
  **Director JSON contract** with tolerant JSON extraction + retry-once.
  14 ledger tests including all four §9.5 acceptance criteria.
- **Builder integration:** new protected `ledger` + `scene` blocks in the
  §6.5 pipeline; ledger injection derives from the fold on every build.
- **Director runner:** after each completed send the gate decides whether the
  utility-model sidecar runs (one combined call: threads + scene + memory
  suggestions; parse failure → silent retry once → give up); new threads
  honor the auto-accept confidence threshold, else land as `suggested`;
  every run writes a `detector_run` marker for the safety net.
- **Ledger UI:** Story ledger section in the Memory sheet — auto-track
  toggle, Open/All filter, thread cards with Resolve/Drop/delete, manual
  thread creation, editable scene fields; **inline chips** on messages
  ("Thread added: …", "fulfilled: …"); Director suggestions inbox
  (Save → memory item, Dismiss).

### Verified (2026-10-03)
- `vitest` 60/60 (incl. all four §9.5 acceptance tests) · typecheck · lint ·
  `vite build` · `cargo check` + `cargo build`.
- Browser e2e: manual thread → inline chip on message → ledger block in the
  prompt (meter grows) → keyword message fires the gate → Director call
  discarded cleanly when the mock provider returns non-JSON (spec behavior) →
  Resolve updates the thread via a new ledger event.

## [0.3.0] — M2 Prompt pipeline & Memory (2026-10-03, in progress)

### Added
- **Block-level prompt builder** (`src/domain/prompt/builder.ts`): fixed §6.5
  block order with per-block token accounting and the trim ladder — oldest
  history → example dialogue → lore (priority asc) → summary; protected
  blocks (system/character/persona/memory/PHI) never dropped; 10 unit tests.
  Replaces the M1 ad-hoc assembly in both generation and impersonation.
- **Layered memory (§7, first slice):** pinned facts (global/character/chat
  scopes) with enable/importance/delete; injected as a protected block;
  Memory side sheet with persona facts, fact CRUD, and live token costs.
- **Rolling summaries:** "Summarize now" / regenerate / delete via the
  **utility model slot**; summaries stored anchored to a message; injected as
  a trimmable block.
- **Token meter:** segmented context-usage bar under the composer, per-block
  colors + total vs. limit + trim count.
- **Prompt Inspector:** live side sheet showing every block (tokens, message
  counts, expandable payloads), the trim log with reasons, and the exact wire
  payload per role.
- **Lorebooks (§8 basic):** books + keyword/constant entries + global/
  character/chat attachments; trigger engine (primary/secondary keywords,
  regex, scan depth) fires entries into a trimmable lore block; Lorebooks
  view with full CRUD. 6 trigger-engine tests.
- **Usage log:** per-generation and per-summary token records with purpose
  tags (cost dashboard arrives in M4).

### Also in this release (M1 completion)
- **Native Anthropic adapter** (Messages API, SSE, system top-level, usage,
  cancellation) and **native Google Gemini adapter**
  (streamGenerateContent?alt=sse, role merging, usage); Test Connection and
  Fetch Models are wire-protocol aware (kind-aware model probes).
- **PNG card export** with the V2 card embedded as a tEXt chunk (round-trips
  with our importer; avatar used as the cover image).
- **Bookmarks** (★) on messages.
- Desktop binary links clean (`cargo build`) with the full provider layer.

### Verified (2026-10-03)
- `vitest` 46/46 · typecheck · lint · `vite build` · `cargo check` + `cargo build`.
- Browser e2e: pin fact → injected (Inspector) · summarize via utility slot →
  summary block · lorebook entry (keyword "bridge") → fired on mention →
  lore block in payload · token meter reflects all blocks · prompt pills,
  avatars, bookmarks unchanged and working.

## [0.2.0] — M1 Chat MVP (2026-10-03, in progress)

### Added
- **Chat engine (tree):** pure branch-aware tree ops (path walk, swipes,
  siblings, subtree delete, cycle-guarded) with 12 unit tests; messages tree
  persisted in SQLite; greetings as root siblings (D-007).
- **Chat UI:** virtualized message list, roleplay-aware formatting
  (`*actions*` italic, `"dialogue"` accent, `(OOC)` dim, code spans) built as
  React nodes (no HTML injection), composer with Enter-to-send, Stop,
  Continue-for-interrupted, Impersonate, per-message token/latency footer.
- **Message actions:** edit in place or as new branch, delete / delete-from-
  here-down (soft), branch from here, fork into new chat, swipes `‹k/n›`,
  redo-as-new-swipe. Active leaf maintained on every operation.
- **Providers:** Rust `provider_stream`/`provider_cancel`/`provider_test`/
  `provider_list_models` commands; OpenAI-compatible SSE adapter with
  cancellation, usage capture, and keychain-read keys (D-016); **mock
  provider** streaming canned replies for offline dev; provider profiles CRUD
  with convenience presets (OpenRouter, DeepSeek, Groq, Ollama, LM Studio,
  KoboldCpp…); main/utility model slots.
- **Characters:** library grid with per-field and per-card token estimates,
  deliberately simple editor — name, personality, scenario, example dialogue,
  first message only (D-022); **avatar images** — picked in the editor,
  downscaled to ≤512px WebP/JPEG and stored in the local DB (D-023), shown on
  cards, the chat header, and assistant messages; JSON card import/export
  (V2-shaped) and **PNG card import** (pure-TS tEXt chunk reader). Richer
  imported fields are preserved and used by the prompt, just not shown in
  the editor.
- **Personas:** CRUD with default flag, quick-switch from the chat header;
  `{{user}}`/`{{char}}` macro engine (incl. legacy `{user}`/`<USER>`,
  `{{date}}`, `{{time}}`, `{{random:…}}`, `{{lastMessage}}`, custom vars).
- **Browser-dev database:** sql.js in-memory SQLite running the same
  migration SQL under the mock transport — the entire app is exercisable
  without the Tauri shell (D-010).
- **In-chat "Proxy" panel:** a pill in the chat header opens per-chat settings —
  aggregator/model override (falls back to the global main slot, chip shows the
  override), temperature/top-p/max-reply-tokens, and a context limit that trims
  oldest history to fit.
- **Prompts as pills (D-025, supersedes the earlier entries/sets UI per user):**
  one prompt concept — "+ Add" creates a named prompt; each prompt is a pill;
  tapping selects it for this chat (✓ marks the active one, tap again returns
  to the default intro); an edit button opens name/content editing; delete
  from the editor. Active prompt is per-chat (`chats.settings.active_prompt_id`);
  content edits apply everywhere the prompt is used. Stored as `presets`
  (kind='prompt'); the structured `prompt_entries` table remains for M2's
  advanced prompt manager.
- TanStack Query for list state; TanStack Virtual for the message list.

### Verified (2026-10-03)
- `vitest` 30/30 · `tsc --noEmit` clean · `eslint` clean · `vite build` ok ·
  `cargo check` clean.
- End-to-end browser session (mock provider, real SQLite via sql.js): mock
  profile → main slot → persona → character → chat with streamed reply
  (tokens + latency recorded) → redo created swipe `‹2/2›` → edit-as-branch
  created user sibling `‹2/2›`.

### Remaining for M1 exit
- Native Anthropic (M1.2) and Gemini (M1.3) adapters.
- PNG card **export** (import ships); bookmark/pin UI affordances.
- Desktop (`tauri dev`) walkthrough of the same chat flow with a real key.

## [0.1.0] — M0 Foundations (2026-10-03, delivered)

### Added
- Repository scaffold: Vite + React 19 + strict TypeScript, ESLint/Prettier,
  Vitest, GitHub Actions CI (3-OS matrix).
- Transport abstraction (`src/services/transport`): `invoke`/`listen` interface
  with `tauri` and `mock` implementations; the `http` transport for the LAN
  companion web client lands in M4.11 (docs: ARCHITECTURE §4.1, F18/D-021).
- M3 theme engine: runtime tonal palettes from a seed color via
  `@material/material-color-utilities`, 8 built-in presets, custom seed picker,
  System/Light/Dark/AMOLED modes, persisted session store. Surface-container
  roles derived from the neutral tonal palette (mcu 0.3.0 lacks them on
  `Scheme`).
- App shell: M3 navigation rail, home + placeholder views, settings view with
  the M0.3 DB spike runner (FTS5 + recursive CTE probe).
- Domain utilities: UUIDv7 generator (table-tested).
- SQLite schema v1 (`migrations/0001_init.sql`, 26 tables) + FTS5
  external-content index (`migrations/0002_fts.sql`), embedded by the Rust core
  via tauri-plugin-sql.
- Rust core: SQL plugin with migrations, keychain commands
  (`secrets_set/get/delete`), bundle icon generation script.

### Verified (2026-10-03, Windows)
- `vitest` 9/9, `tsc --noEmit` clean, `eslint` clean, `vite build` ok.
- `cargo check` clean under stable-msvc (tauri 2.12, sqlx, wry, keyring).
- Desktop app launches (`npm run tauri dev` → `hearth.exe`).
- Both migration files execute against real SQLite; FTS5 MATCH + recursive CTE
  probes pass (28 tables created).
- Theme switching (Light/Dark/AMOLED × 8 seed presets) verified live in a
  browser session, including persistence across reload.

### Notes
- Spec deviations this milestone: none beyond pre-approved docs flags
  (F16–F18 additions recorded in docs/DECISIONS.md).
- Vite's FSWatcher is configured to ignore `src-tauri/` — cargo's build
  artifacts crash it with EBUSY on Windows otherwise.
