# Hearth — Decision Log (ADR shorts)

Format: **D-### Title** — Context → Decision → Consequences. Full reasoning in `ARCHITECTURE.md` §2 where flagged.

- **D-001 Tauri 2 over Electron** — Spec offered either. → Tauri 2. Native keychain, small footprint, no Chromium shipping. Cost: three webview engines to respect; WebView2 bootstrapper bundled on Windows.

- **D-002 Domain core in TypeScript, thin Rust** — Spec §14 implied prompt builder + ledger folding in Rust. → All domain logic (tree, prompt, ledger, lore, macros) is pure TS in `src/domain`, Vitest-tested; Rust only for keys/network/disk. One language for the branch-aware core = iteration speed where churn is highest. Deviation from spec, flagged (F2).

- **D-003 Custom M3 layer on Radix, not `@material/web`/MUI** — `@material/web` is in maintenance, no M3 Expressive (F1). → ~24-component M3 library on Radix primitives, styled by tokens from `material-color-utilities`. We own visuals/motion; Radix owns a11y behavior. Fixed inventory prevents scope creep.

- **D-004 `tauri-plugin-sql`, gated on M0 spike** — F3. → Use the plugin (SQL stays in TS) iff bundled SQLite has FTS5 + usable recursive CTEs; else drop in a thin rusqlite command layer behind the identical TS client API. Spike M0.3, timeboxed 1 day.

- **D-005 Soft deletes for all destructive ops** — Undo snackbars (spec §11.3) require recoverability. → `deleted_at` tombstones for messages/branches/etc.; permanent delete only via explicit Branch Map pruning.

- **D-006 Generation manifests on messages** — "Reconstructed" prompts stop being deterministic once memory/lore are edited later (F6). → Persist compact per-generation manifest (blocks, trims, token counts, referenced items) in `messages.meta.generation`; Inspector offers as-generated vs what-would-send-now.

- **D-007 Synthetic root node; alt greetings are root siblings** — Siblings need a common parent; NULL can't group. → One hidden root message per chat; greetings and user openers are its children. Unifies greeting switching with swipe/branch mechanics.

- **D-008 UUIDv7 text ids generated app-side** — Create-idempotent, index-friendly, no DB round-trip to learn an id.

- **D-009 Backups via `VACUUM INTO`** — Copying a live WAL DB file is unsafe (F14). → Rust-side consistent snapshot → zip → rolling rotation.

- **D-010 E2e = Playwright with mocked Tauri IPC** — tauri-driver is slow/flaky cross-platform (F10). → UI e2e runs against Vite with a mock IPC layer in CI; a small Windows tauri-driver suite covers real shell/keychain/SQL.

- **D-011 AI memory suggestions ride the Director (M3)** — M2's inbox has no cheap, non-noisy producer before it (F7). → M2 ships storage + inbox UI; suggestions activate in M3 with the combined sidecar call.

- **D-012 Suggestion dismissal is chat-global, not path-folded** — Folding suggestions through branch events adds complexity for little user value. → Suggestions anchor to a message for display; accept/dismiss applies chat-wide.

- **D-013 Model slots global + per-chat overrides** — Spec §10 role slots. → `model_slots` table for defaults; `chats.slot_overrides` JSON for per-chat main/utility/embedding choices.

- **D-014 Linux keychain fallback** — Portable Linux builds may lack Secret Service (F13). → Degrade to encrypted-at-rest file with a visible warning; Windows/macOS always use the OS keychain.

- **D-015 Redo = new sibling + leaf move** — Spec's "delete & regenerate in place" with keep-as-swipe default. → Redo always creates a new assistant sibling and moves the active leaf; "discard permanently" setting tombstones the old sibling (still undoable, D-005).

- **D-016 OpenAI-compatible is the universal wire protocol** — Covers OpenAI/OpenRouter/DeepSeek/Together/Groq/Mistral/xAI/LM Studio/vLLM/llama.cpp/KoboldCpp/Ollama (F4). → Only three wire adapters exist in Rust: openai_compat, anthropic, gemini. Local tools get convenience presets, not native adapters.

- **D-017 (reserved for M0.3 spike outcome — plugin-SQL vs rusqlite)**

- **D-018 Proxy profiles: multiple, switchable, attached per provider + global default** — Spec §10 has no proxy story, but reaching providers through relays is a common hard requirement (F16). → `proxy_profiles` table (HTTP/HTTPS/SOCKS5/SOCKS5h); passwords in keychain; per-profile `proxy_id` where NULL inherits the global default and a NULL global means direct; system proxy env vars ignored unless explicitly enabled (protects local providers); switching is instant (per-request client build) and exposed as a command-palette action.

- **D-019 Advanced prompt entries; author's note becomes a built-in entry** — Spec §6.5's fixed block order + editable preset lacks the SillyTavern-style prompt-manager power users expect (F17). → Scoped `prompt_entries` (global/character/chat layers) with roles, block anchoring or depth-N injection, branch-aware timed effects (always/once/every N via path length), per-entry token budget / trim priority / lock. The canonical 12-block pipeline stays the default; the author's note is demoted to a built-in entry, removing a special case from the builder and Inspector.

- **D-020 Prompt presets: whole-configuration snapshots, switchable per chat** — Spec §6.5.1 says "multiple presets" but never defines scope or switching. → A prompt preset bundles system prompt + prompt entries + block budgets + template; sampler params stay a separate preset family (`kind='params'`) and character data never enters a preset. One global default + `chats.prompt_preset_id` override; quick-switch (chat-header dropdown, later command palette) takes effect on the next generation; JSON export/import for sharing; built-in seeds marked `builtin`.

- **D-021 Transport abstraction; LAN companion web client** — Team wants phone access while the spec's non-goals only exclude native mobile apps (F18). → The UI talks to the core exclusively through a `Transport` interface with tauri/mock/http implementations; an axum server embedded in the Rust process (M4.11, default off, optional headless mode) serves the same UI over LAN and bridges the same command registry, with per-device pairing-token auth. Phone = thin client of the single-user local core; no second backend is ever written. Chose transport abstraction over a separate mobile codebase because it costs ~0.5 d in M0 and eliminates dual-backend drift forever.

- **D-022 First-party character editor stays minimal (5 fields)** — User directive, 2026-10-03: the editor exposes only **name, personality, scenario, example dialogue, first message**; system-prompt shaping belongs to provider/preset configuration later, not the card. → Editor UI trimmed accordingly. The DB keeps the full column set (description, alt greetings, system_prompt_override, post_history_instructions, creator_notes, tags): imports still capture complete community cards, the prompt assembler still consumes whatever is present, and a future "advanced" editor tab can expose them without a migration.

- **D-023 Avatars stored as resized data URLs in the DB** — Avatars (and later per-chat backgrounds) are downscaled to ≤512px and re-encoded to WebP/JPEG in the UI layer, stored in `character_assets.path` as a `data:` URL. → No filesystem management, no asset-protocol config, works identically under Tauri and the browser-dev/e2e path, and survives export/import naturally. Trade-off: large libraries grow the DB file; if that ever matters, migrate `path` values to files behind the same join — the `character_assets` schema already supports file paths.

- **D-024 In-chat "Proxy" panel as the prompt/preset precursor** — User directive, 2026-10-03: aggregator switching, custom/advanced prompts, and generation limits belong inside the chat window, behind one pill. → The Proxy sheet writes per-chat overrides to `chats.slot_overrides` (D-013) and `chats.settings`, and stores custom prompts in the real `prompt_entries` table (chat scope) — so M2.10's full prompt-entry model and M2.11's prompt presets upgrade the storage semantics without changing this UI's data source. Context limit is enforced by newest-first history trimming in the assembler until the full TokenBudgeter (M2.2) replaces it.

- **D-025 One prompt concept: named pills, tap-to-select (supersedes D-024's entries/sets UI)** — User follow-up, 2026-10-03: "advanced prompt, custom prompt and system prompt are all the same thing." → The Proxy panel's prompt section is a pill list: "+ Add" names a prompt, tapping a pill selects it for the chat (✓ marks active; tap again reverts to the default intro), an ✎ button opens inline name/content editing with delete. Active selection is per chat (`chats.settings.active_prompt_id`); content is shared, so edits apply to every chat using that prompt. Storage moved from the `prompt_entries` table to `presets` (kind='prompt', data `{content}`); the `prompt_entries` table remains reserved for M2's structured prompt manager (F17/D-019).
