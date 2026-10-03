import { useChat } from '../../stores/chat';
import { useSheetA11y } from '../../hooks/useSheetA11y';

/** Live "what would send now" view of the assembled prompt (§6.5 Inspector). */
export function InspectorSheet({ onClose }: { onClose: () => void }) {
  const sheetRef = useSheetA11y(onClose);
  const { lastBuild, genSettings } = useChat();

  return (
    <div className="proxy-backdrop" onClick={onClose}>
      <aside
        ref={sheetRef}
        tabIndex={-1}
        className="proxy-sheet"
        role="dialog"
        aria-label="Prompt inspector"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="proxy-head">
          <h2>Inspector</h2>
          <button type="button" className="m3-button m3-button-text" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="field-hint">
          What the model would receive on the next send. ≈ {lastBuild?.totalTokens ?? 0} tokens total
          {genSettings.context_tokens ? ` · limit ${genSettings.context_tokens}` : ''}.
        </p>

        {lastBuild && lastBuild.trimLog.length > 0 && (
          <section className="proxy-section">
            <h3>Trim log</h3>
            <ul className="inspector-trims">
              {lastBuild.trimLog.map((t, i) => (
                <li key={i}>
                  <strong>{t.target}</strong> — {t.reason} (~{t.tokens} tok)
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="proxy-section">
          <h3>Blocks</h3>
          {lastBuild?.blocks.map((b) => (
            <details key={b.id} className="inspector-block">
              <summary>
                <span className="inspector-block-label">{b.label}</span>
                <span className="field-tokens">≈ {b.tokens} tok{b.messageCount !== undefined ? ` · ${b.messageCount} msg` : ''}</span>
              </summary>
              <pre className="inspector-payload">{b.content || '(empty)'}</pre>
            </details>
          ))}
        </section>

        <section className="proxy-section">
          <h3>Wire payload</h3>
          {lastBuild?.wire.map((m, i) => (
            <details key={i} className="inspector-block">
              <summary>
                <span className="inspector-block-label">{m.role}</span>
                <span className="field-tokens">{m.content.length} chars</span>
              </summary>
              <pre className="inspector-payload">{m.content}</pre>
            </details>
          ))}
        </section>
      </aside>
    </div>
  );
}
