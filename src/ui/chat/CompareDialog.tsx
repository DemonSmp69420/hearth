import { renderRoleplay } from './roleplay';
import { useChat } from '../../stores/chat';
import { Card } from '../components/m3';

/**
 * M5.1 compare mode: side-by-side live candidates; picking one inserts it as
 * the assistant reply (the other done candidates ride along as swipes).
 */
export function CompareDialog() {
  const compare = useChat((s) => s.compare);
  if (!compare) return null;

  return (
    <div className="chat-detail-empty chat-dialog-overlay compare-overlay" role="dialog" aria-label="Compare candidate replies">
      <div className="compare-panel">
        <header className="compare-head">
          <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: 0 }}>
            Compare replies
          </h2>
          <div className="m3-segmented" role="radiogroup" aria-label="Number of candidates">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={compare.count === n}
                className={compare.count === n ? 'm3-segment selected' : 'm3-segment'}
                onClick={() => void useChat.getState().startCompare(n)}
              >
                ×{n}
              </button>
            ))}
          </div>
          <button type="button" className="m3-button m3-button-text" onClick={() => void useChat.getState().cancelCompare()}>
            Close
          </button>
        </header>
        <p className="field-hint" style={{ margin: '0 0 10px' }}>
          Same context sent {compare.count} times. Pick the reply you want — the others stay
          available as swipes ‹n/n› on the message.
        </p>
        <div className={`compare-grid cols-${compare.count}`}>
          {compare.candidates.map((c, i) => (
            <Card key={c.genId} variant="elevated" className="compare-card">
              <div className="compare-card-head">
                <span className="compare-index">Candidate {i + 1}</span>
                <span className="compare-status">
                  {c.status === 'streaming' && 'writing…'}
                  {c.status === 'error' && 'failed'}
                  {c.status === 'done' && `${c.text.length} chars`}
                </span>
              </div>
              <div className="compare-text">
                {c.status === 'error' ? (
                  <span className="composer-error">{c.message}</span>
                ) : (
                  renderRoleplay(c.text || '…')
                )}
              </div>
              <button
                type="button"
                className="m3-button m3-button-filled"
                disabled={c.status !== 'done' || !c.text.trim()}
                onClick={() => void useChat.getState().pickCandidate(i)}
              >
                Use this
              </button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
