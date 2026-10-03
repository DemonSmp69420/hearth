# Hearth

A local-first, private desktop app for roleplaying and chatting with AI
characters. Branching conversations, layered memory, a token-frugal story
ledger, and a best-in-class prompt pipeline — with API keys in the OS
keychain and nothing leaving your machine except calls to the LLM providers
you choose.

**Status: feature-complete through M5; M6 (hardening) in progress.** See
[docs/ROADMAP.md](docs/ROADMAP.md) for the milestone plan and the
changelog for what shipped.

> **⚠️ AI-generated software.** This entire project — every line of code,
> documentation, and design decision — was created by AI language models
> (Claude/ZCode and other agents), directed by a human with no programming
> background. It works and is tested, but it has never been security-audited
> by a human expert. Use it knowing that.

## Highlights

- **Chat as a tree** — swipes, regenerate-any-message, edit-as-branch,
  branch/fork, delete with undo; every derived state is branch-aware.
- **Group chats** — round-robin / auto / manual turn order, `@mentions`,
  per-speaker colors and avatars.
- **Prompt pipeline** — fixed block order with per-block budgets and a
  documented trim ladder; Prompt Inspector + token meter make every token
  accountable. See [docs/PROMPT_PIPELINE.md](docs/PROMPT_PIPELINE.md).
- **Story ledger** — promises and quests tracked across hundreds of messages
  and across branches for ~200 tokens/turn, with a zero-cost gate that makes
  ordinary chats free. See [docs/LEDGER.md](docs/LEDGER.md).
- **Layered memory** — persona, pinned facts, lorebooks, rolling summaries,
  and an AI-suggestion inbox.
- **Providers** — OpenAI-compatible + native Anthropic/Gemini, keys in the OS
  keychain, main/utility model slots, per-chat overrides, network proxy
  profiles.
- **Companion web access** — open the same app in a phone browser over LAN
  (pairing-token auth).
- **M3 theming** — 8 presets + custom seeds + AMOLED, WCAG AA enforced by
  test. See [docs/THEMING.md](docs/THEMING.md).
- **Privacy** — PIN lock, panic key, blur mode; local backups; import/export
  (Character Cards V2/V3 as JSON/PNG, SillyTavern chat logs, Markdown/TXT).

## Prerequisites

- **Node.js 20+** and npm
- **Rust (stable, MSVC)** — `rustup` with the `stable-msvc` toolchain
- **Visual Studio Build Tools** with the "Desktop development with C++"
  workload (MSVC v143 + Windows 11 SDK)
- WebView2 Runtime (preinstalled on Windows 11)

## Quick start

```bash
npm install

# UI shell in the browser (mock provider + in-memory SQLite — no keys needed)
npm run dev

# Full desktop app (real SQLite, keychain, providers)
npm run tauri dev

# Tests / typecheck / lint / production build
npm test
npm run typecheck
npm run lint
npm run build

# Windows installers (NSIS + MSI) into src-tauri/target/release/bundle
npm run tauri build
```

The first browser run works entirely offline through the **Mock provider**:
create a character → Chat → talk. To use a real model, open **Providers**,
pick a preset (OpenAI, Anthropic, Gemini, OpenRouter, local Ollama/LM
Studio…), paste a key (stored in the OS keychain), and set the **main**
model slot.

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, modules, data model, decisions F1–F18 |
| [docs/PROMPT_PIPELINE.md](docs/PROMPT_PIPELINE.md) | How prompts are assembled and trimmed |
| [docs/LEDGER.md](docs/LEDGER.md) | The story ledger and Director |
| [docs/THEMING.md](docs/THEMING.md) | M3 tokens, presets, AA guarantee |
| [docs/I18N.md](docs/I18N.md) | String externalization status |
| [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md) | Manual release checklist |
| [docs/ROADMAP.md](docs/ROADMAP.md) / [docs/DECISIONS.md](docs/DECISIONS.md) | Plan and decision log |
| [CHANGELOG.md](CHANGELOG.md) | What shipped, per milestone |

## Repository layout

```
docs/            architecture, roadmap, decisions, feature docs
migrations/      versioned SQL migrations (embedded by the Rust core)
scripts/         icon generator + dev utilities
src/             React UI, stores, services, pure domain code (TS)
src-tauri/       Rust core: provider HTTP/SSE, keychain, SQL, backups,
                 companion server
```

## License

Released under the [PolyForm Noncommercial License](LICENSE) — **free for
anyone to use, study, modify, and redistribute for noncommercial purposes**.
Commercial use and monetization are not permitted. Keeping the license notice
with copies is the only condition (that's the attribution). Like the rest of
the project, it was built with AI and is shared openly.
