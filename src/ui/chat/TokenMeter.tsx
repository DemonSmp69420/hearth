import { useEffect } from 'react';
import { useChat } from '../../stores/chat';
import type { BlockId } from '../../domain/prompt/builder';

const BLOCK_COLORS: Record<BlockId, string> = {
  system: 'var(--md-sys-color-primary)',
  character: 'var(--md-sys-color-tertiary)',
  group: 'var(--md-sys-color-secondary-container)',
  persona: 'var(--md-sys-color-secondary)',
  memory: 'var(--md-sys-color-error)',
  lore: '#8f7a4a',
  ledger: '#b3702a',
  scene: '#5a8a5a',
  summary: '#4a7a8f',
  example: '#7a4a8f',
  history: 'var(--md-sys-color-outline)',
  phi: '#4a8f6a',
  entry: 'var(--md-sys-color-inverse-surface)',
  entryDepth: 'var(--md-sys-color-inverse-surface)',
};

const LABELS: Record<BlockId, string> = {
  system: 'System',
  character: 'Character',
  group: 'Cast',
  persona: 'Persona',
  memory: 'Memory',
  lore: 'Lore',
  ledger: 'Ledger',
  scene: 'Scene',
  summary: 'Summary',
  example: 'Example',
  history: 'History',
  phi: 'PHI',
  entry: 'Entry',
  entryDepth: 'Entry',
};

/** Segmented context-usage bar under the composer (§6.5 token meter). */
export function TokenMeter() {
  const { lastBuild, genSettings, previewBuild } = useChat();
  const activeLeafId = useChat((s) => s.activeLeafId);
  const messages = useChat((s) => s.messages);
  const activePromptId = useChat((s) => s.activePromptId);
  const memoryItems = useChat((s) => s.memoryItems);
  const summary = useChat((s) => s.summary);
  const ledgerEvents = useChat((s) => s.ledgerEvents);

  useEffect(() => {
    void previewBuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    messages.length,
    activeLeafId,
    genSettings,
    activePromptId,
    memoryItems.length,
    summary?.id,
    ledgerEvents.length,
  ]);

  const limit = genSettings.context_tokens ?? 0;
  const total = lastBuild?.totalTokens ?? 0;
  const pct = limit > 0 ? Math.min(100, (total / limit) * 100) : 0;

  return (
    <div className="token-meter" aria-label={`Prompt uses about ${total} tokens${limit ? ` of ${limit}` : ''}`}>
      <div className="token-meter-bar">
        {lastBuild?.blocks
          .filter((b) => b.tokens > 0)
          .map((b) => (
            <span
              key={b.id}
              title={`${LABELS[b.id]}: ~${b.tokens} tok`}
              style={{
                flexGrow: b.tokens,
                background: BLOCK_COLORS[b.id],
              }}
            />
          ))}
      </div>
      <div className="token-meter-label">
        ≈ {total} tokens{limit > 0 ? ` / ${limit} (${pct.toFixed(0)}%)` : ' · no limit set'}
        {lastBuild && lastBuild.trimLog.length > 0 && ` · ${lastBuild.trimLog.length} trims`}
      </div>
    </div>
  );
}
