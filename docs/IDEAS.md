# Hearth — Ideas (optional; implement only if cheap or clearly high-value)

| Idea | Value | Cost | Verdict |
|---|---|---|---|
| **Prompt diff view**: diff the as-generated payload between two swipes or branch siblings — makes "why did this reply differ" inspectable | High for transparency nerds (principle 5) | M (Inspector already has manifests — diff them) | Do in M4 if Inspector lands early |
| **Thread snooze**: hide a pending thread from injection until its keyword reappears — saves cap space for 12+ open threads | Medium (token economy) | S | Do with M3.4 |
| **Branch Map minimap**: tiny strip version of the tree in the chat header showing where you are | Medium (orientation in long chats) | S (canvas already exists from M4.1) | Do after M4.1 |
| **Story-book export**: render a chat branch to a clean reading layout (print/PDF/EPUB) — the "finished RP becomes a book" moment | High delight, great for sharing privately | M | M5 candidate |
| **Daily cost soft-cap notification**: warn at a user-set spend/day using usage_log estimates | Medium (trust) | S | Do with M4.9 dashboard |
| **Swipe keyboard navigator**: `←/→` on a focused message cycles siblings with a preview overlay; `1..9` jumps | Medium (power users) | S | Cheap, fold into M1.10 polish |
| **Import from JanitorAI link (via JannyAI mirror)**: paste `janitorai.com/characters/…`, Hearth fetches the card PNG from `api.jannyai.com/api/v1/download` (same endpoint SillyTavern uses) and runs it through the existing PNG importer. Third-party dependency: mirror has no uptime guarantee and not all bots are in its dataset — on failure the UI shows an apology plus manual self-help steps (swap the domain to jannyai.com in the browser, download, import the file). | High delight, tiny cost | S | **Shipped 2026-10-03** (M4 bonus; desktop + companion bridge) |

Not doing (rejected): live collaborative editing, cloud sync, plugin sandboxing beyond spec's P3 extension API, voice cloning.
