# Hearth — Architecture

**Status:** v0.1 draft for team review (pre-M0) · 2026-10-03 · Author: engineering
**Inputs:** Product spec (§ references below point at it) · This document + `ROADMAP.md` are the review gate for starting M0.

---

## 1. TL;DR of what this document decides

1. **Shell confirmed: Tauri 2.** Electron rejected (footprint, native keychain, no shipped Chromium).
2. **`@material/web` verdict: do not use.** It is in maintenance and lacks M3 Expressive. We build our own M3 component layer on **Radix UI primitives**, styled by real M3 design tokens generated at runtime with `@material/material-color-utilities`.
3. **Language split: all domain logic in TypeScript, running in the webview.** Rust is a thin trust/IO core: provider HTTP + SSE, keychain, disk assets, backups. This deviates from spec §14 ("Rust unit tests for the prompt builder and ledger folding") — see flag F2.
4. **Branch-awareness is the correctness core:** every derived artifact (summary, ledger state, scene state, detector runs) is a pure **fold over events anchored to nodes on the active path**. One memoized folding engine, property-tested.
5. **SQLite via `tauri-plugin-sql`**, gated on an M0 spike proving FTS5 + recursive CTEs work in its bundled SQLite; documented fallback is a thin `rusqlite` command layer.
6. Full schema v1 below, soft deletes everywhere destructive, per-message **generation manifests** so the Prompt Inspector can show "as-generated" payloads truthfully.

---

## 2. Spec flags & deviations (review this section first)

| # | Spec ref | Flag | Decision / proposal |
|---|---|---|---|
| F1 | §3 Design system | `@material/web` is in maintenance; no M3 Expressive, awkward React integration | Custom M3 component library on Radix primitives + M3 tokens from `material-color-utilities`. We own ~24 components; Radix supplies a11y/keyboard behavior for the hard ones (D-003) |
| F2 | §3, §14 | Spec implies prompt builder + ledger folding live in Rust (Rust unit tests). That splits one domain model across two languages and slows the branch-aware core — the highest-churn code in M1–M3 | **Deviation:** domain core in TypeScript (pure, no I/O), tested in Vitest. Rust keeps only what needs OS trust: keys, network, disk. Prompt assembly is string work over ≤ a few hundred KB — no perf case for Rust (D-002) |
| F3 | §3 Database | Choice between `rusqlite`/`sqlx` and the Tauri SQL plugin left open | `tauri-plugin-sql` (keeps all queries + schema evolution in TS), **gated on M0 spike** for FTS5/CTE support in its bundled SQLite. Fallback: ~200-line `rusqlite` command layer, same TS API (D-004) |
| F4 | §10 Local providers | Spec lists native adapters for Ollama, LM Studio, KoboldCpp, text-generation-webui | All four speak OpenAI-compatible HTTP today. Ship **one** OpenAI-compatible adapter + convenience presets (base URLs pre-filled). Native Ollama adapter only if a needed feature appears (D-017) |
| F5 | §5, §6.3 deletes | "Delete" semantics vs. undo snackbars (§11.3) | All destructive message/branch ops are **soft deletes** (`deleted_at`), undoable; hard delete only via explicit "prune permanently" in Branch Map (D-005) |
| F6 | §6.5 Prompt Inspector | "Reconstructed" payload for any past message is only deterministic while memory/lore/threads are never edited later — but they are editable | Store a compact **generation manifest** on each generated message (blocks included, trims, per-block token counts, lore/memory/threads referenced). Inspector shows *as-generated* (manifest) and *what would send now* (recompute). Small JSON per message (D-006) |
| F7 | §7 / M2 | Memory Suggestions Inbox is M2, but AI suggestions require the Director sidecar (M3) | M2 ships suggestion storage + inbox UI; AI-generated suggestions go live with the Director in M3. Heuristic-only suggestions are too noisy to ship (D-011) |
| F8 | §6.3 Continue | No provider-agnostic "continue" exists | If adapter supports assistant-prefill (Anthropic): send partial as trailing assistant turn. Otherwise: re-send with the partial text as a suffix-instruction and replace on completion. Exposed as adapter capability flag |
| F9 | §12 import | "SillyTavern / Janitor import [P1/P2]" is ambiguous | Character card import (PNG/JSON) = **P1, M1**. Chat-log import (SillyTavern JSONL/JSON) = **P2, M4**. Export MD/JSON/TXT = M4 |
| F10 | §14 e2e | tauri-driver/WebDriver e2e is slow and flaky cross-platform in CI | Primary e2e: **Playwright against the Vite dev server with a mocked Tauri IPC layer** (fast, deterministic, covers all UI logic). Plus one small tauri-driver smoke suite on Windows for shell integration (D-010) |
| F11 | §5 chats | `character(s)` — group chats later | Single `character_id` now; migrate to a `chat_members` join table in M5 when group chats land. Migration path is trivial; premature generality now is not free |
| F12 | §14 i18n | "i18n-ready" decays fast if deferred | Typed string dictionaries + `t()` from M1. Adding keys later is mechanical; retrofitting extraction is not |
| F13 | §3 Secrets | Linux portable builds may have no Secret Service (keyring crate needs gnome-keyring/KWallet) | Windows/macOS: keychain. Linux without Secret Service: fall back to a `safeStorage`-style encrypted file **with a visible warning**. Windows is primary, so this is a packaging note, not a blocker (D-014) |
| F14 | §12 backups | Naive file-copy of a live WAL database is unsafe | Rust-side backup via `VACUUM INTO` (consistent snapshot) → zip → rolling rotation (D-009) |
| F15 | §13 overall | Full spec ≈ 80–95 ideal dev-days (see ROADMAP) — ~4–4.5 months single dev | Sequencing protects P1s: M0–M3 (the P1 critical path) ≈ 11 weeks. P3s explicitly parked in M5+. Updated 2026-10-03 for F16–F18: ≈ 98 ideal dev-days, ~4.5–5 months |
| F16 | §10 Providers | **No proxy support in the spec.** Multiple *provider profiles* exist, but users commonly need HTTP/SOCKS relays to reach providers at all (regional blocks, privacy) — and the ability to keep several and switch | **Addition:** `proxy_profiles` (HTTP/HTTPS/SOCKS5/SOCKS5h, multiple named entries), attached per provider profile with a global default, credentials in keychain, quick-switch via command palette + test-via-proxy diagnostics. Scheduled M1.15 (D-018) |
| F17 | §6.5 Prompt builder | Spec fixes a 12-block order with an editable preset, but has no equivalent of SillyTavern-style **advanced prompts**: user-defined entries with roles, injection depth, timed effects, and per-character/per-chat layers | **Addition [P2]:** `prompt_entries` layer — custom blocks anchored before/after canonical blocks or injected at depth N from the end; always/once/every-N timing (branch-aware via path length); per-entry token budget, trim priority, lock. Model+builder in M2.10 (avoids a retrofit), manager UI in M4.10; author's note becomes a built-in entry (D-019) |
| F18 | §2 Non-goals | Spec rules out mobile apps, but the team wants **phone access**: open Hearth in a phone browser while the desktop app runs | **Addition [P2]:** Companion web client — the same UI served over LAN HTTP+WS by an embedded server, single-user, pairing-token auth. Not a mobile app (no store build), not multi-user, not cloud sync: the phone is a thin client of the same local core and database. Requires a `Transport` abstraction in the UI from M0 (D-021); server core in M4.11, phone-responsive pass in M5.12 |

---

## 3. Confirmed stack

| Concern | Choice | Rationale / risk |
|---|---|---|
| Shell | **Tauri 2.x** (Rust core) | Small footprint, native keychain via `keyring`, no Chromium bundle. Cost: webview differs per OS (WebView2 / WKWebView / WebKitGTK). WebView2 bootstrapper bundled for Windows |
| UI | **React 18 + TypeScript (strict) + Vite** | Per spec. Strict TS, `noUncheckedIndexedAccess` on |
| Components | **Radix UI primitives + custom M3 layer** (`~24 components`, §12.4) | F1. Radix gives headless a11y (dialog, menu, select, tabs, tooltip, popover, slider, switch); we implement M3 visuals + motion on top |
| Color / tokens | `@material/material-color-utilities` → CSS custom properties | Runtime scheme generation, contrast levels, image→seed |
| State | Zustand (session/UI) + TanStack Query (persisted/async) | Per spec. Query wraps all DB reads; mutations invalidate by key |
| Lists | `@tanstack/react-virtual` (dynamic measure) | 10k+ messages must scroll at 60fps |
| Markdown | `remark`/`rehype` + `rehype-sanitize` + roleplay visitor | §6.4 formatting; sanitize config is an allowlist |
| Companion server | **axum embedded in the Rust core** (HTTP + WebSocket), default off; optional headless `--server` mode | F18/D-021: serves the built UI to phone browsers over LAN, bridges the same command registry |
| Tokenizer | `js-tiktoken` (lazy, per-encoding ranks) → fallback chars/3.7 → provider-reported usage | Estimates always labeled; provider numbers authoritative after generation |
| DB | SQLite (WAL) + FTS5 via `tauri-plugin-sql` (F3 spike pending) | Versioned SQL migrations from day one; pre-migration file backup |
| Rust crates | tokio, reqwest, eventsource-stream, keyring, serde/serde_json, png (card chunks), image (thumbnails), zip | Kept deliberately small |
| Testing | Vitest · Playwright (+ IPC mock) · tauri-driver smoke (Windows) · GitHub Actions 3-OS matrix | F10 |

---

## 4. Process model & trust boundary

```
┌─────────────────────────── UI (webview, TS) ───────────────────────────┐
│  React + M3 layer                                                       │
│  ui/ → stores/ (Zustand) → services/ → domain/ (pure TS)                │
└───────┬───────────────────────────────────────────────▲────────────────┘
        │ Tauri commands (invoke)                       │ events (streams)
┌───────▼───────────────────────────────────────────────┴────────────────┐
│  src-tauri (Rust, thin core — no business logic)                        │
│   provider/  openai_compat · anthropic · gemini   ← keys from keyring  │
│              at call time; keys NEVER cross IPC                         │
│   secrets/   keyring get/set/delete                                     │
│   media/     PNG card chunk IO, WebP thumbnails                         │
│   backup/    VACUUM INTO + zip + rotate                                 │
│   db/        open DB, WAL, migrations bootstrap (F3 fallback lives here)│
└───────┬────────────────────────────────────────────────────────────────┘
        │ tauri-plugin-sql (SQL from TS) · plugin-fs/dialog
   SQLite (WAL + FTS5) + assets dir + OS keychain
```

**Rules:**
- The webview performs **zero network fetches** (enforced by CSP). All provider traffic is Rust commands streaming normalized events back.
- API keys live in the OS keychain, keyed by profile id. Rust reads them at call time; they never appear in IPC payloads, state, logs, or exports.
- `domain/` is pure TypeScript: no Tauri imports, no React, no I/O. Enforced by an ESLint boundary rule. Everything hard gets unit-tested here.

### 4.1 Transport abstraction & companion web access (F18, D-021)
- The UI **never calls Tauri APIs directly**. It calls a `Transport` interface (`invoke(cmd, args)`, `listen(event, handler)`). Three implementations: `tauri` (desktop IPC), `mock` (unit tests / e2e / browser dev), `http` (companion server: fetch + WebSocket event stream). Chosen at boot by feature detection; the boundary rule keeps views transport-agnostic.
- **Companion server [P2, M4.11]:** an axum server embedded in the Rust process (toggleable in settings, default off; optional `hearth --server` headless mode for machines that stay on). It serves the built frontend over LAN on a configurable port and routes `invoke` calls to the **same command registry** the desktop webview uses, streaming events over one WebSocket. Desktop keeps zero-hop IPC; the phone browser is just another client of the same backend, database, and single-user session.
- **Security posture:** binds LAN-only by default (never 0.0.0.0 without explicit setting), requires a random pairing token shown as a QR code in the desktop app on first connect per device, revocable sessions list, no caching headers on API routes, and keys/DB never leave the Rust process. Latency-sensitive streaming works over the same WS.

---

## 5. Module map

```
src-tauri/src/
  main.rs · lib.rs
  provider/    mod.rs (trait + normalized types) · openai_compat.rs · anthropic.rs · gemini.rs
  secrets/     keyring wrapper
  media/       png_card.rs (tEXt chara/ccv3) · thumbnails.rs (WebP)
  backup/      snapshot + zip + rotation
  db/          bootstrap (fallback rusqlite layer if F3 spike fails)

src/
  domain/                    ← PURE TS, fully unit-tested
    types/       schema types (single source; mirrors migrations)
    tree/        insert, path walk, siblings/swipes, branch, fork, soft delete
    prompt/      builder.ts · budgeter.ts (trim ladder) · macros.ts · templates.ts
    ledger/      heuristics.ts · director.ts (contract+validate) · fold.ts · inject.ts
    memory/      layers · suggestions model
    lore/        trigger engine (keywords, regex, recursion [P2])
    tokens/      estimator interface · heuristic · tiktoken adapter
    util/        id (uuidv7) · time · json
  services/                  ← orchestration over IPC + DB
    db/          client · migrations · queries (typed, TanStack Query wrapped)
    chat/        ChatService (tree ops, streaming state machine, single-writer queue)
    provider/    profile CRUD · model lists · slot resolution · usage_log
    director/    run gating · path-aware run markers · suggestion inbox
    summary/     chunking · anchoring · regeneration
    search/      FTS queries + filters
    backup/ importexport/ theme/ usage/
  stores/        session.ts (active chat, sheets, drafts, streaming) · settings.ts
  ui/
    components/m3/   button, icon-button, card, chip(s), text-field, menu, dialog,
                     snackbar, tabs, tooltip, switch, slider, segmented-button, list,
                     nav-rail, side-sheet, progress, search-bar, banner, fab
    views/           chats/ characters/ personas/ lorebooks/ providers/ settings/ home/
    sheets/          memory/ ledger/ branches/ inspector/ lore/
    chat/            MessageList (virtualized) · MessageItem · Composer · TokenMeter
  i18n/          en.json + typed t()
```

---

## 6. Data model

### 6.1 Conventions
- IDs: **UUIDv7** text, generated app-side (create-idempotent, index-friendly) (D-008).
- Timestamps: INTEGER ms epoch. JSON: TEXT columns named `*_json` where confusing, else documented.
- **Soft delete** (`deleted_at`) for messages, threads (via events), memory, lore entries, characters, chats.
- **Every derived row anchors to a message node** (`anchor_message_id`) so branch validity is checkable.
- Append-only event tables are never mutated.

### 6.2 Tables (v1; evolves via versioned migrations)

```sql
settings(key TEXT PK, value JSON);                    -- kv
provider_profiles(id, name, type, base_url, default_model,
                  custom_headers JSON, default_params JSON, proxy_id NULL,
                  enabled, created_at, updated_at);   -- API key lives ONLY in keychain;
                                                     -- proxy_id NULL = inherit global default proxy
proxy_profiles(id, name, protocol /*http|https|socks5|socks5h*/, host, port,
               username, enabled, created_at, updated_at);
               -- password ONLY in keychain (account: proxy:<id>), never in DB/exports/logs
               -- global default proxy id lives in settings kv; NULL = direct connection
model_slots(slot TEXT PK /*main|utility|embedding*/, profile_id, model, params JSON);

personas(id, name, avatar_asset_id, pronouns, role, appearance, personality,
         backstory, preferences, is_default, created_at, updated_at);

characters(id, name, avatar_asset_id, banner_asset_id, description, personality,
           scenario, example_dialogue, system_prompt_override,
           post_history_instructions, tags JSON, creator_notes,
           favorite, folder_id, extra JSON, created_at, updated_at, deleted_at);
           -- first_message + alt_greetings live in extra? NO: dedicated columns
           -- first_message TEXT, alt_greetings JSON  (greetings seed root siblings, §6.3)
character_assets(id, character_id, kind /*avatar|banner|gallery|sprite|background*/,
                 path, meta JSON, created_at);

chats(id, title, character_id, persona_id, active_leaf_id,
      slot_overrides JSON, prompt_preset_id NULL, settings JSON /*ledger cfg, style, vars, background…*/,
      pinned, archived, folder_id, created_at, updated_at, last_message_at, deleted_at);

messages(id, chat_id, parent_id /*NULL only for the synthetic root*/,
         ord INTEGER /*sibling order*/,
         role /*user|assistant|system|narrator*/, speaker_character_id,
         content, status /*complete|streaming|interrupted|failed*/,
         model, provider_profile_id, params_snapshot JSON,
         prompt_tokens, completion_tokens, latency_ms, finish_reason,
         hidden, pinned, bookmarked, bookmark_note,
         meta JSON /*generation manifest (F6), director refs, swipe labels…*/,
         created_at, updated_at, deleted_at);

message_edits(id, message_id, prior_content, edited_at, source);

memory_items(id, scope /*global|persona|character|chat*/, scope_id, kind, text,
             enabled, pinned, importance /*1..3*/, source /*user|ai*/,
             anchor_message_id, confidence, created_at, updated_at, deleted_at);

summaries(id, chat_id, anchor_message_id /*covers up to & incl. this node*/,
          covers_from_id, covers_to_id, content, token_count, model,
          status, created_at, updated_at, deleted_at);

lorebooks(id, name, description, created_at, updated_at);
lore_entries(id, book_id, title, content, keywords_primary JSON,
             keywords_secondary JSON, regexes JSON, constant, enabled,
             priority, position, scan_depth, probability, inclusion_group,
             token_budget, cooldown, sticky, created_at, updated_at, deleted_at);
lore_attachments(id, book_id, scope /*global|character|persona|chat*/, scope_id);

ledger_events(id, chat_id, seq INTEGER, anchor_message_id NOT NULL,
              event_type /*thread_create|thread_update|thread_merge|
                          thread_delete|scene_set|detector_run*/,
              payload JSON, source /*user|ai|heuristic*/, confidence,
              created_at);                           -- APPEND-ONLY, event-sourced

suggestions(id, chat_id, anchor_message_id, kind /*memory|thread*/,
            payload JSON, status /*pending|saved|edited|dismissed*/,
            created_at);                             -- inbox; dismissal is global (D-012)

prompt_templates(id, name, kind /*chat|completion*/, body, builtin);
presets(id, name, kind /*params|prompt*/, data JSON);
        -- kind='prompt': {system_prompt, entries[], block_budgets, template_id}  (§8.7)
        -- kind='params': sampler params (temperature, …); the two families never mix
prompt_entries(id, scope /*global|character|chat*/, scope_id, name, content,
               role /*system|user|assistant*/, enabled, locked,
               anchor /*'before:<block>' | 'after:<block>'*/, depth INTEGER NULL,
               timing /*always|once|every_n*/, period INTEGER, phase INTEGER,
               token_budget, trim_priority,
               created_at, updated_at, deleted_at);   -- F17: depth injection when depth NOT NULL
themes(id, name, source_color, scheme_variant, contrast, custom JSON, builtin);
folders(id, name, parent_id, kind /*chat|character*/, sort);
usage_log(id, ts, purpose /*chat|summary|director|title|suggest|embedding|test*/,
          profile_id, model, prompt_tokens, completion_tokens, est_cost_usd,
          chat_id, meta JSON);

-- FTS (contentless-synced via triggers)
CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid');
```

Indexes: `messages(chat_id, parent_id, ord)`, `messages(chat_id, deleted_at, created_at)`, `ledger_events(chat_id, anchor_message_id, seq)`, `summaries(chat_id, anchor_message_id)`, `usage_log(ts)`, `usage_log(chat_id)`.

### 6.3 Tree rules & invariants
1. Each chat has exactly one **synthetic root** message (`parent_id IS NULL`, role `system`, empty content, hidden). All visible top-level nodes — greetings, the user's own opener — are children of root. **Alt greetings = sibling assistant nodes under root**; "change greeting" = switch active sibling (D-007).
2. Swipes = sibling `assistant` nodes; "edit user message as new branch" = sibling `user` node. `ord` is explicit (timestamps are not an ordering signal).
3. Active path = walk `active_leaf_id → root` via recursive CTE (depth-guarded at 100k as a cycle tripwire; tree ops guarantee acyclicity).
4. `active_leaf_id` never points at a soft-deleted node; branch switches restore nothing implicitly — switching back is always possible because nothing is destroyed (F5).
5. **Single-writer discipline:** all tree mutations funnel through ChatService's serialized queue (prevents orphan/leaf races from fast UI interaction during streaming).
6. Streaming writes: partial content is persisted in ≥400ms batches (status `streaming`); on crash, restart marks orphaned `streaming` rows `interrupted` and offers Continue. Worst-case loss: the last batch (~400ms), never the message.

---

## 7. Branch-aware derived state — the correctness core

One engine, four consumers (summaries, ledger, scene, detector-run distance):

```
activePath(chatId) -> ordered message ids root→leaf     (cached per leaf id)
fold(pathSet, pathIndex):
    ledger state   = ledger_events where anchor_message_id ∈ pathSet
                     ordered by (pathIndex, seq) → apply creates/updates/merges
    scene state    = last scene_set per field along path
    summaries      = valid summaries whose anchor ∈ pathSet, deepest-coverage-first
    detector lull  = path length − pathIndex(last detector_run anchor)
```

- Pure functions of (events, path). Same path ⇒ same folds, always — property-tested.
- Memoized by `(leafId)`; leaf switches are O(diff) in practice because folds are cached per visited leaf.
- **Every side panel reads fold outputs.** Review rule: no derived state may be computed branch-blind. The §5 correctness requirement ("switching branches instantly changes what the AI knows") is tested at the fold layer and at the PromptBuilder layer.

---

## 8. Prompt-assembly pipeline

### 8.1 Block order (spec §6.5, fixed) and default budgets

| # | Block | Default budget | Trimmable |
|---|---|---|---|
| 1 | Global system prompt / preset | 500 tok | **never** |
| 2 | Character (description/personality/scenario) | — | **never** |
| 3 | Persona `{{user}}` | 300 tok | **never** |
| 4 | Pinned memory | 400 tok | **never** |
| 5 | Triggered lore | 800 tok | by priority asc |
| 6 | Ledger (open threads only) | 200 tok hard | importance-ranked, never grows |
| 7 | Scene state | 150 tok | compact serialization, field cap |
| 8 | Rolling summary | 700 tok | condensable (regenerate shorter) |
| 9 | Example dialogue | 600 tok | yes, early |
| 10 | Recent history (+ pinned msgs) | *remainder* | oldest-first |
| 11 | Author's note @ depth | 200 tok | **never** |
| 12 | Post-history instruction / steering | 200 tok | **never** |

### 8.2 Trim ladder (TokenBudgeter)
Over budget ⇒ trim in this order, logging every drop into the **trim log**:
1. Oldest non-pinned history messages (one at a time),
2. Example dialogue (all-or-nothing),
3. Non-constant lore by priority ascending,
4. Rolling summary → request a shorter regeneration from the utility model (applies next turn; current turn truncates with a note in the trim log).

Never trimmed, never silently dropped: blocks 1–4, 11, 12, the character card.

### 8.3 Macros
`{{user}}`, `{{char}}`, `{user}`, `<USER>`, `{{date}}`, `{{time}}`, `{{random:a,b,c}}`, `{{lastMessage}}`, custom chat variables (`/setvar`, stored in `chats.settings`). Expansion happens **before** token estimation; the macro engine is pure and table-tested (§14).

### 8.4 Templates
Tiny Handlebars-subset renderer (no dependency): templates reference blocks (`{{blocks.ledger}}`, `{{blocks.character}}`) so users can reorder/rewrite assembly per preset. Two kinds: **chat-completion** (role-mapped messages) and **completion** (serialized text with stop strings) for local/legacy backends [P2].

### 8.5 Generation manifest (F6)
Each generated message stores, in `messages.meta.generation`:
```json
{ "template": "default-chat", "blocks": [{"id":"ledger","tokens":184,"items":["T3","T5"]}],
  "trims": [{"dropped":"history #12–#44","reason":"over budget"}],
  "lore_fired": ["bridge-lore"], "summary_used": "sum_9f2", "total_tokens": 7421 }
```
The Prompt Inspector has two modes: **As generated** (reads the manifest — truthful even after later edits) and **What would send now** (re-runs the builder against current state).

### 8.6 Advanced prompt entries [P2] (F17, D-019)
The fixed 12-block order is the default and always exists; power users get a **prompt manager** layer on top:
- **Entries** are user-defined blocks (macro-aware) stored per scope (global / character / chat; layers merge additively at build time). Fields: `role` (system/user/assistant), `enabled`, `locked` (joins the never-trim set), `token_budget`, `trim_priority`.
- **Positioning** is either anchored to a canonical block (`before:` / `after:` character, lore, history, …) or **injected at depth N from the end** of the assembled history — the author's-note mechanism, generalized to any entry.
- **Timed effects:** `always` · `once` · `every N turns`. Turn count is active-path length, so timing is branch-aware like everything else (§7) — an every-3 entry fires at the same story beats on any branch.
- The **author's note becomes a built-in entry** (at_depth, unlocked by default) instead of a special case in the builder; card `post_history_instructions` and per-generation steering remain distinct canonical blocks.
- Entries render through the same templates (§8.4), appear as first-class rows in the Prompt Inspector and generation manifest (§8.5), and trim by `trim_priority` (default just above example dialogue in the ladder) unless `locked`.

### 8.7 Prompt presets — save, switch, share
Spec §6.5.1 requires "fully editable, multiple presets" for the system prompt; this is the full form (D-020):
- A **prompt preset** is a named, saved snapshot of the whole prompt configuration: system prompt text + the §8.6 entry set (content, order, enabled, timing) + block budget settings + template choice. It deliberately does **not** include sampler params (those are `presets.kind='params'`) or character-card data — so a preset composes cleanly with any character and persona.
- **Switching:** one global default + `chats.prompt_preset_id` per-chat override (NULL = global default). Quick-switch via a chat-header dropdown (M2) and the command palette (M4); a switch applies to the very next generation, and the Inspector's *what-would-send-now* view lets you preview the result before committing a message.
- Manage: "save current setup as preset", duplicate, rename, delete, set-as-default, **export/import as JSON** for sharing (no secrets ever included).
- Ships with built-in seeds (e.g., *Default roleplay*, *Novel style*, *Minimal*) marked `builtin` — copied on first edit, originals preserved.

---

## 9. Ledger pipeline (flagship)

### 9.1 Heuristic gate (Stage 1 — zero tokens)
- **Pattern list** (user-editable JSON in settings): commitment/promise/objective/appointment/threat regexes (`/\bI'(ll| promise)\b/i`, `/\byou (must|have to|need to)\b/i`, `/\b(before|by) (dawn|midnight|tomorrow|the)\b/i`, `/\bquest|mission|debt|owe\b/i`, …).
- **Resolution watch:** any open thread's keywords appear in the last ~2 messages.
- **Safety net:** detector lull ≥ N (default 15) along the active path (§7 — this is why run markers are ledger events, not a chat column).
- No trigger ⇒ **no network call at all**. (Acceptance test 4 verifies this with a mock provider counting calls.)

### 9.2 Director call (Stage 2 — one combined sidecar call)
Input is minimal by construction: last 2–4 path messages + compact open-thread list `(id, displayId, title, keywords, status, importance)` + scene schema. Output is the strict JSON contract from spec §9.3, validated with zod; on parse failure discard silently and retry **at most once**. One call returns threads + scene + memory suggestions together (§13 token-economy rule 4).

New threads land as `suggested` (inbox) unless auto-accept ≥ X is on; approved creates a `thread_create` event **anchored to the triggering message**. Updates from the Director also anchor to the current leaf. Thread display ids (`T3`) are generated at fold time for stability.

Caps: ≤ 2 new threads per run; soft cap 12 open (above ⇒ prune prompt / auto-archive lowest importance). Injection: open threads only, one line each, 200-token hard cap, ranked importance → keyword relevance → recency; optional 1–3 "recently resolved" one-liners.

**Modes:** sidecar (default) · inline `<ledger>` tag in main-model output, stripped before display with a robust parser (off default) · manual (`/ledger` commands + UI only).

### 9.3 Acceptance tests (M3 exit gate, spec §9.5)
1. Promise thread created → 150 filler messages later still injected, block ≤ 200 tokens.
2. Keyword mention triggers resolution check → fulfilled, with evidence link.
3. Branch from before creation ⇒ thread absent on that branch, present again on switch back.
4. No-commitment chat ⇒ **zero** Director calls (mock provider call counter).

Plus property tests: fold purity per path; run-marker lull correctness after branch switches.

---

## 10. Memory & summaries
- Layers per spec §7 table → storage: persona/pinned facts = `memory_items`; ledger & scene = event folds; summaries = `summaries`; lore = lorebooks. The Memory Panel is one read model over all of them, with per-item token cost and "injected right now" view.
- **Rolling summaries:** when live history (block 10) would exceed its share of budget, summarize the oldest chunk (anchored at chunk end). Valid on any branch containing the anchor; a branch whose path lacks needed summaries lazily generates its own (utility model), cached per anchor — token cost is visible in usage_log per §13.
- Suggestions inbox: `suggestions` rows anchored to a message; Save/Edit/Dismiss; nothing AI-written becomes permanent without approval or the explicit auto-accept setting (F7 timing note).
- Semantic retrieval [P2, off by default]: embeddings table + top-k with strict cap; provider endpoints first, local ONNX deferred (open question Q2).

---

## 11. Providers & secrets
- Rust trait: `list_models() · stream_chat(request) -> StreamEvent* · test_connection() · count_tokens() (optional)`. Normalized `StreamEvent { delta?, usage?, finish_reason?, error? }` emitted over Tauri events (`provider://stream/<generationId>`); cancellation via command (abort flag drops the request).
- Wire protocols we implement: **OpenAI-compatible** (covers OpenAI, OpenRouter, DeepSeek, Together, Groq, Mistral, xAI, LM Studio, vLLM, llama.cpp, KoboldCpp, Ollama — F4), **Anthropic**, **Gemini** (`alt=sse`). SSE quirks handled per adapter; each has fixture-based unit tests (recorded byte streams).
- Retry: exponential backoff honoring `Retry-After` / rate-limit headers; timeouts configurable; provider error text surfaced verbatim but readable; failures leave partial content intact with inline Retry (F8 continue semantics).
- Keychain: service `hearth`, account = profile id. Debug logging opt-in and key-masked. Usage logged per purpose (`chat|summary|director|…`) for the cost dashboard.
- **Proxies (F16):** multiple named proxy profiles (HTTP/HTTPS/SOCKS5/SOCKS5h; `socks5h` = remote DNS). Each provider profile attaches one; NULL inherits the global default, and a NULL global default means direct. Proxy passwords live in the keychain (`proxy:<id>`) and are masked in logs/exports. reqwest clients are built per request with the `socks` feature; system `HTTP(S)_PROXY`/`ALL_PROXY` env vars are **ignored unless explicitly enabled**, so a shell env never silently hijacks local-provider traffic. Test Connection reports `via <proxy name>` in its diagnostics; the command palette offers a quick "set global proxy" action, and switching is instant (next request uses the new route).
- Model slots (main/utility/embedding) with per-chat overrides; fallback chain [P2].

---

## 12. Theming (M3)

### 12.1 Token pipeline
`source color → DynamicScheme (variant: tonal-spot default; vibrant/expressive/neutral options) → ~60 Material color roles → CSS custom properties (--md-sys-color-*)`, regenerated on theme switch with no reload. Contrast levels standard/medium/high map to scheme contrast levels; a **unit test computes WCAG ratios for all role pairs across all shipped themes and enforces AA** (§11.3).

### 12.2 Modes & presets
Light · Dark · **AMOLED** (dark scheme with `background/surface/surface-container → #000`) · System. ≥ 8 built-in presets (Violet Dusk, Forest, Rose, Ocean, Amber, Slate, Mono, Sakura) + creator (seed picker, live preview, export/import JSON) + **seed from character avatar** (`sourceColorFromImage`, per-chat theme option).

### 12.3 Typography, shape, motion, density
M3 type scale as CSS vars; separate `--reading-font` for message bodies (serif option for long-form); user font size/line-height/width/density. Shape scale + motion tokens (durations/easings incl. expressive springs via CSS `linear()`); `prefers-reduced-motion` and an in-app toggle override everything.

### 12.4 Component inventory (custom M3 layer)
button · icon-button · fab · card (filled/outlined/elevated) · assist/filter/input/suggestion chips · text field · search bar · menu · dialog · snackbar (+undo) · tabs · tooltip · switch · slider · segmented button · list · navigation rail · side sheet · progress (linear/circular) · banner · checkbox/radio. Radix supplies behavior for: dialog, menu, select, tabs, tooltip, popover, slider, switch, toggle-group, scroll-area.

---

## 13. Security model
- **CSP:** `default-src 'self'; img-src 'self' asset: https://asset.localhost data:; connect-src 'self' ipc: http://ipc.localhost` — the webview cannot reach the network at all.
- Markdown/HTML rendered only through the sanitize allowlist; no `eval`/remote code paths; no telemetry.
- Keys: keychain only (never in DB, exports, logs, or IPC payloads).
- Exports exclude secrets by construction (they never leave the keychain).
- **Companion server** (F18): LAN-only bind, per-device pairing tokens, revocable sessions; API responses no-store; the token never travels in URLs.
- Privacy [P2]: app lock (PIN) + panic key + blur-until-hover. **DB encryption at rest is a flagged stretch**, not committed — see open question Q3.

---

## 14. Testing strategy (maps to spec §14)

| Suite | Location | What it proves |
|---|---|---|
| tree ops | `domain/tree` | insert/path/swipes/branch/fork/soft-delete invariants (§6.3) |
| branch-aware folding | `domain/ledger/fold`, `domain/memory` | purity per path; §9.3 tests 3 & 4 |
| prompt assembly & trimming | `domain/prompt` | block order, budgets, trim ladder, never-drop set |
| macro expansion | `domain/prompt/macros` | all macros incl. nesting/order/custom vars |
| lore triggering | `domain/lore` | keywords/regex/constant/scan depth/priority |
| provider adapters | Rust + SSE fixtures | streaming quirks per provider, cancel, retry, usage parse |
| card import/export | `media/png_card` + TS | V2/V3 round-trips, chunk edge cases |
| theme contrast | `theme` | AA across all presets × modes × contrast levels |
| e2e smoke | Playwright + IPC mock | first-run → chat → branch → theme → search |
| shell smoke | tauri-driver (Windows CI) | window, keychain, real SQL |

Fixtures: recorded SSE byte streams per provider; synthetic 10k-message chat generator; card corpus (V2 PNG, V3 PNG, JSON, dirty inputs).

---

## 15. Performance strategy
- **Cold start < 2s:** defer provider pings, thumbnail scanning, FTS warmup; code-split views.
- **Streaming:** deltas buffered and flushed per animation frame; markdown re-parse throttled (150ms/message); typewriter pacing decoupled from chunk arrival.
- **10k-message chats:** virtualized list; active path id list cached per leaf; message bodies fetched in windowed chunks around scroll; folds memoized; path CTE target < 5ms warm.
- Images: WebP thumbnails generated at import (Rust `image`), lazy-loaded; originals on demand.
- All automatic LLM features logged to `usage_log` — "smart feature" cost is never hidden (§13).

---

## 16. Risks & spikes

| Risk | L×I | Mitigation |
|---|---|---|
| `tauri-plugin-sql` bundled SQLite lacks FTS5 (or CTE perf is poor) | M×H | **M0 spike decides**; fallback = thin rusqlite layer behind the same TS API (D-004) |
| Markdown rendering jank while streaming long messages | M×M | throttled re-parse, memoized AST, measure with 4k-token messages |
| Radix-based M3 layer scope creep | M×M | fixed 24-component inventory (§12.4); anything else is composed, not added |
| Anthropic/Gemini API drift | M×L | adapter fixture tests; adapters isolated in Rust |
| Branch Map at 10k nodes | M×M | canvas renderer with LOD (collapsed subtrees); M4 spike |
| Linux keychain absent in portable builds | L×L | F13 fallback + warning; Windows primary |
| Code signing cost/notarization | M×L | ship unsigned v1 with clear instructions; Q1 |
| Scope (the real risk) | H×H | ROADMAP sequenced so M0–M3 delivers every P1; P3s parked |

---

## 17. Open questions (non-blocking — defaults chosen, say the word to override)

1. **Code signing:** buy Windows EV cert + Apple notarization, or ship unsigned with instructions? *Default: unsigned v1.*
2. **Embeddings [P2]:** provider endpoints only, or bundle a local ONNX model (~50MB)? *Default: provider endpoints; local deferred.*
3. **DB encryption at rest:** SQLCipher through the plugin is invasive. *Default: plain SQLite + app-lock + OS-level protection; encryption flagged stretch.*
4. **v1 language:** English-only strings but typed-dictionary ready. *Default: English.*

Cross-references: `ROADMAP.md` (milestone tasks) · `DECISIONS.md` (D-records) · `IDEAS.md` (optional additions).
