# Hearth — Final QA checklist (M6)

Run through this before a release build. Browser-dev (mock provider) covers
most rows; rows marked **[Desktop]** need `npm run tauri dev` or an installed
build.

## First run & shell
- [ ] App launches; theme resolves (system mode follows OS).
- [ ] **[Desktop]** Fresh install: database migrates from empty; `hearth.db` created.
- [ ] Navigation rail switches all views; skip link appears on Tab and jumps to content.

## Providers & keys
- [ ] **[Desktop]** Create a provider profile; API key saved to the OS keychain (check Windows Credential Manager under "hearth").
- [ ] Test Connection reports success/failure with the real endpoint in the message.
- [ ] Fetch Models fills the model datalist; manual model entry works.
- [ ] Main + utility slots set; missing-slot error message is clear when unset.

## Characters & personas
- [ ] Create/edit a character (5 fields + avatar); token counts update live.
- [ ] Import a community card (JSON + PNG); export JSON and PNG round-trip.
- [ ] Persona CRUD; persona switch in the chat header changes `{{user}}`.

## Chat engine
- [ ] Send → streamed reply; Stop freezes it as `interrupted`; Continue finishes it.
- [ ] Regenerate on ANY assistant reply creates a swipe `‹2/2›`; old branch reachable via swipes.
- [ ] Edit in place vs. edit-as-new-branch; branch from here; fork into new chat.
- [ ] Delete / delete-from-here-down leaves the rest navigable; undo via swipes still possible.
- [ ] Impersonate fills the composer draft.

## Prompt pipeline
- [ ] Token meter segments change when memory/lore/ledger are present.
- [ ] Inspector shows blocks, trim log, and wire payload; matches a real send (Inspectors' total ≈ footer's prompt tokens).
- [ ] Context limit set (e.g. 4096) → oldest history trimmed; protected blocks never dropped; clear error when protected blocks alone overflow.
- [ ] Named prompt pills: add/edit/select (✓)/deselect; active prompt replaces the default intro.

## Memory, ledger, lore
- [ ] Pin a fact → appears in Inspector's memory block; importance/enable work.
- [ ] Threads: auto-track toggle (off = nothing injected, nothing tracked); manual add; Resolve/Drop; inline chips on messages.
- [ ] Branch before a thread's creation → thread gone; switch back → restored.
- [ ] Lorebook entry with keyword fires on mention (check Inspector lore block).
- [ ] Summarize now (utility slot) → summary block appears.

## Search, stats, org
- [ ] Global search finds a phrase from an old chat and deep-links to it.
- [ ] Command palette (`Ctrl/Cmd+K`) jumps and runs actions; `?` shows shortcuts.
- [ ] Pin/archive/folder/tag a chat; filters work.
- [ ] Stats page shows tokens; usage dashboard splits by purpose.

## Privacy & companion
- [ ] PIN lock: set → launch gate appears; wrong PIN rejected; **Lock now** works.
- [ ] Panic key `Ctrl+Shift+H` hides the window. **[Desktop]**
- [ ] Companion server: enable in Settings → pair from a phone browser → chat round-trips. **[Desktop]**

## Reliability
- [ ] Mid-stream crash/kill → message marked `interrupted`, Continue offered. **[Desktop]**
- [ ] Backup runs; restore into a fresh install works. **[Desktop]**
- [ ] 10k-message chat: open, scroll, and search stay responsive (soak test in CI covers the engine).
