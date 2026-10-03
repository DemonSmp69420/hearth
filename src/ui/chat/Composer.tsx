import { useRef, useState, type CSSProperties } from 'react';
import { estimator } from '../../domain/tokens/estimator';
import { accentFor } from '../../theme/accent';
import { useChat } from '../../stores/chat';
import { RewriteRow } from './RewriteRow';

export function Composer() {
  const { send, stop, impersonate, stream, messages, activeLeafId, error, compare, members, genSettings, character, speakAs, sendOoc, nextBeats, generateNextBeats } =
    useChat();
  const [draft, setDraft] = useState('');
  const [oocMode, setOocMode] = useState(false);
  const impersonating = useRef(false);

  const last = activeLeafId
    ? [...activePathLocal(messages, activeLeafId)].reverse().find((m) => m.role === 'assistant')
    : undefined;
  const canContinue = !stream && last?.status === 'interrupted';

  // M5.2 manual mode: the user picks who answers via the Speak chips.
  const manualMode =
    members.length > 0 && (genSettings.group?.turnOrder ?? 'round-robin') === 'manual';
  const speakers = [
    ...(character ? [{ id: null as string | null, name: character.name }] : []),
    ...members.filter((m) => m.mute !== 1).map((m) => ({ id: m.character_id, name: m.name })),
  ];

  const submit = () => {
    const text = draft.trim();
    if (!text || stream || compare) return;
    setDraft('');
    if (oocMode) {
      void sendOoc(text);
    } else {
      void send(text);
    }
  };

  const draftImpersonate = async () => {
    if (impersonating.current || stream) return;
    impersonating.current = true;
    try {
      const suggestion = await impersonate();
      if (suggestion) setDraft((d) => (d ? `${d}\n${suggestion}` : suggestion));
    } finally {
      impersonating.current = false;
    }
  };

  return (
    <div className="composer">
      {error && (
        <div className="composer-error" role="alert">
          {error}
        </div>
      )}
      {manualMode && !stream && (
        <div className="speak-row">
          <span className="speak-label">Who speaks next:</span>
          {speakers.map((s) => (
            <button
              key={s.id ?? 'lead'}
              type="button"
              className="speak-chip"
              style={{ '--member-color': accentFor(s.name).primary } as CSSProperties}
              disabled={compare !== null}
              onClick={() => void speakAs(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {!stream && genSettings.nextBeats?.enabled && nextBeats.length > 0 && (
        <div className="speak-row beat-row">
          <span className="speak-label">Next:</span>
          {nextBeats.map((b, i) => (
            <button
              key={`${i}-${b}`}
              type="button"
              className="speak-chip"
              title="Add to the composer"
              onClick={() => setDraft((d) => (d ? `${d} ${b}` : b))}
            >
              {b}
            </button>
          ))}
          <button
            type="button"
            className="m3-button m3-button-text beat-refresh"
            title="Regenerate suggestions"
            onClick={() => void generateNextBeats()}
          >
            ↻
          </button>
        </div>
      )}
      {!stream && draft.trim() && !oocMode && <RewriteRow text={draft} onResult={setDraft} />}
      <div className="composer-row">
        <button
          type="button"
          className="m3-button m3-button-text"
          title="Ask the AI to draft your reply"
          disabled={stream !== null}
          onClick={() => void draftImpersonate()}
        >
          Impersonate
        </button>
        <button
          type="button"
          className={oocMode ? 'm3-button m3-button-filled ooc-toggle' : 'm3-button m3-button-text ooc-toggle'}
          title="Scratchpad mode: the note is kept in the chat but never sent to the AI"
          aria-pressed={oocMode}
          onClick={() => setOocMode((v) => !v)}
        >
          OOC
        </button>
        <textarea
          className="composer-input"
          placeholder={
            oocMode
              ? 'Scratchpad note — for you only, the AI never sees this…'
              : 'Write your reply… (Enter to send, Shift+Enter for a new line)'
          }
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {stream ? (
          <button type="button" className="m3-button m3-button-filled" onClick={() => void stop()}>
            Stop
          </button>
        ) : (
          <>
            {canContinue && (
              <button type="button" className="m3-button m3-button-tonal" onClick={() => void useChat.getState().continueLast()}>
                Continue
              </button>
            )}
            <button
              type="button"
              className="m3-button m3-button-tonal"
              title="Generate several replies in parallel and pick one"
              disabled={compare !== null}
              onClick={() => void useChat.getState().startCompare(3)}
            >
              Compare
            </button>
            <button type="button" className="m3-button m3-button-filled" disabled={!draft.trim() || compare !== null} onClick={submit}>
              {oocMode ? 'Note' : 'Send'}
            </button>
          </>
        )}
      </div>
      <div className="composer-meter" aria-hidden="true">
        draft ≈ {estimator.estimate(draft)} tokens
      </div>
    </div>
  );
}

function activePathLocal<T extends { parent_id: string | null; id: string }>(
  messages: T[],
  leafId: string | null,
): T[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const out: T[] = [];
  const seen = new Set<string>();
  let cursor = leafId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    out.push(node);
    cursor = node.parent_id;
  }
  return out.reverse();
}
