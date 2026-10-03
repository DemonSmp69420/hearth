import { useState } from 'react';
import { useChat, type RewriteMode } from '../../stores/chat';

const MODES: { id: RewriteMode; label: string; title: string }[] = [
  { id: 'shorter', label: 'Shorter', title: 'Condense to about half the length' },
  { id: 'longer', label: 'Longer', title: 'Expand with more detail' },
  { id: 'vivid', label: 'Vivid', title: 'More vivid and descriptive' },
  { id: 'grammar', label: 'Grammar', title: 'Fix grammar and spelling only' },
];

/**
 * M5.5 writing aids: one-click rewrites of a draft (composer) or an existing
 * message (edit box). The result replaces the text in place — the original is
 * one undo away for drafts, or a swipe/branch away for saved messages.
 */
export function RewriteRow({ text, onResult }: { text: string; onResult: (t: string) => void }) {
  const rewriteText = useChat((s) => s.rewriteText);
  const busy = useChat((s) => s.busy);
  const stream = useChat((s) => s.stream);
  const [working, setWorking] = useState<RewriteMode | null>(null);
  const disabled = busy || stream !== null || working !== null || !text.trim();

  const run = async (mode: RewriteMode) => {
    setWorking(mode);
    try {
      const out = await rewriteText(text, mode);
      if (out.trim()) onResult(out.trim());
    } catch {
      // already surfaced via the store's error banner
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="rewrite-row">
      <span className="speak-label">Rewrite:</span>
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className="speak-chip"
          title={m.title}
          disabled={disabled}
          onClick={() => void run(m.id)}
        >
          {working === m.id ? '…' : m.label}
        </button>
      ))}
    </div>
  );
}
