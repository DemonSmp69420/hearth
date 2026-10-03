import { useEffect, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useChat } from '../../stores/chat';
import { useSession, type FontChoice } from '../../stores/session';
import { getModelSlots, listCharacters, listProviderProfiles } from '../../services/db/queries';
import { accentFor, accentVars } from '../../theme/accent';
import { Card } from '../components/m3';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { ProxyPanel } from './ProxyPanel';
import { InspectorSheet } from './InspectorSheet';
import { MemorySheet } from './MemorySheet';
import { BranchMap } from './BranchMap';
import { CompareDialog } from './CompareDialog';
import { TokenMeter } from './TokenMeter';

const FONT_STACKS: Record<FontChoice, string> = {
  default: 'var(--md-sys-font-reading, system-ui, sans-serif)',
  serif: 'Georgia, "Times New Roman", serif',
  round: '"Segoe UI", "Trebuchet MS", Verdana, sans-serif',
  mono: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
};

const AVATAR_PX: Record<string, number> = { hidden: 0, sm: 28, md: 40, lg: 56 };

export function ChatView() {
  const { activeChatId, character, persona, personas, setPersona, modelOverride, refreshMemory, genSettings, members, setMemberMute, removeMember, consistencyWarnings, clearConsistencyWarnings } =
    useChat();
  const reading = useSession((s) => s.reading);
  const [panel, setPanel] = useState<'proxy' | 'inspector' | 'memory' | 'map' | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const slots = useQuery({ queryKey: ['slots'], queryFn: getModelSlots });
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: listProviderProfiles });

  useEffect(() => {
    void useChat.getState().refreshChats();
  }, []);

  useEffect(() => {
    if (activeChatId) void refreshMemory();
  }, [activeChatId, refreshMemory]);

  if (!activeChatId || !character) return null;

  // Effective model: per-chat override wins, then the global main slot.
  const overrideProfile = profiles.data?.find((p) => p.id === modelOverride?.profile_id);
  const mainSlot = slots.data?.find((s) => s.slot === 'main');
  const mainProfile = profiles.data?.find((p) => p.id === mainSlot?.profile_id);
  const model = modelOverride
    ? (modelOverride.model ?? overrideProfile?.default_model)
    : (mainSlot?.model ?? mainProfile?.default_model);
  const isOverridden = Boolean(modelOverride);
  const accentOn = genSettings.accent?.enabled === true;

  const chatVars: CSSProperties = {
    '--chat-font-family': FONT_STACKS[reading.fontChoice],
    '--chat-font-size': `${reading.fontSize}px`,
    '--chat-line-height': String(reading.lineHeight),
    '--chat-max-width': `${reading.chatWidth}px`,
    '--chat-avatar-size': `${AVATAR_PX[reading.avatarSize] ?? 40}px`,
  } as CSSProperties;
  const classes = [
    'chat-view',
    `style-${reading.chatStyle}`,
    ...(reading.avatarSize === 'hidden' ? ['avatars-hidden'] : []),
  ].join(' ');

  return (
    <div
      className={classes}
      style={{
        ...(accentOn ? accentVars(character.name) : {}),
        ...chatVars,
      }}
    >
      <header className="chat-header">
        <button type="button" className="m3-button m3-button-text" onClick={() => useChat.getState().closeChat()}>
          ‹ Chats
        </button>
        <div className="chat-header-title">
          {character.avatar_path && (
            <img className="chat-header-avatar" src={character.avatar_path} alt="" />
          )}
          <strong>{character.name}</strong>
          {model && <span className={isOverridden ? 'chat-model-chip overridden' : 'chat-model-chip'}>{model}</span>}
        </div>
        <button type="button" className="proxy-pill" onClick={() => setPanel('map')}>
          Map
        </button>
        <button type="button" className="proxy-pill" onClick={() => setPanel('memory')}>
          Memory
        </button>
        <button type="button" className="proxy-pill" onClick={() => setPanel('inspector')}>
          Inspector
        </button>
        <button type="button" className="proxy-pill" onClick={() => setPanel('proxy')} aria-haspopup="dialog">
          Proxy
        </button>
        <label className="persona-switch">
          <span>as</span>
          <select
            value={persona?.id ?? ''}
            onChange={(e) => void setPersona(e.target.value || null)}
            aria-label="Switch persona"
          >
            <option value="">(no persona)</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </header>
      {members.length > 0 && (
        <div className="group-bar">
          <span className="group-bar-label">Cast</span>
          {members.map((m) => (
            <span
              key={m.id}
              className={m.mute === 1 ? 'member-chip muted' : 'member-chip'}
              style={{ '--member-color': accentFor(m.name).primary } as CSSProperties}
            >
              <button
                type="button"
                title={m.mute === 1 ? 'Muted — tap to let them speak again' : 'Tap to mute (skip their turns)'}
                onClick={() => void setMemberMute(m.id, m.mute !== 1)}
              >
                {m.name}
              </button>
              <button
                type="button"
                className="member-chip-x"
                title="Remove from cast"
                aria-label={`Remove ${m.name}`}
                onClick={() => void removeMember(m.id)}
              >
                ×
              </button>
            </span>
          ))}
          <button type="button" className="member-add" onClick={() => setAddOpen(true)}>
            ＋ Add
          </button>
        </div>
      )}
      {addOpen && <AddMemberDialog onClose={() => setAddOpen(false)} />}
      {consistencyWarnings.length > 0 && (
        <div className="consistency-strip" role="alert">
          <strong>
            ⚠ {consistencyWarnings.length} possible contradiction{consistencyWarnings.length > 1 ? 's' : ''} with your
            pinned facts:
          </strong>
          <ul>
            {consistencyWarnings.map((w, i) => (
              <li key={i}>
                “{w.fact}” — reply says something like <em>{w.cue}…</em> ({Math.round(w.confidence * 100)}%)
              </li>
            ))}
          </ul>
          <button type="button" className="m3-button m3-button-text" onClick={clearConsistencyWarnings}>
            Dismiss
          </button>
        </div>
      )}
      <MessageList />
      <Composer />
      <TokenMeter />
      {panel === 'proxy' && <ProxyPanel onClose={() => setPanel(null)} />}
      {panel === 'inspector' && <InspectorSheet onClose={() => setPanel(null)} />}
      {panel === 'memory' && <MemorySheet onClose={() => setPanel(null)} />}
      {panel === 'map' && <BranchMap onClose={() => setPanel(null)} />}
      <CompareDialog />
    </div>
  );
}

/** M5.2: pick a character to join this chat's cast. */
function AddMemberDialog({ onClose }: { onClose: () => void }) {
  const { members, addMember } = useChat();
  const chars = useQuery({ queryKey: ['characters'], queryFn: listCharacters });
  const memberIds = new Set(members.map((m) => m.character_id));
  const candidates = (chars.data ?? []).filter((c) => !memberIds.has(c.id));

  return (
    <div className="chat-detail-empty chat-dialog-overlay link-dialog" onClick={onClose}>
      <Card variant="elevated" className="inline-editor-card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ font: 'var(--md-sys-typescale-title-lg)', margin: '0 0 8px' }}>Add cast member</h2>
        <p style={{ margin: '0 0 12px', color: 'var(--md-sys-color-on-surface-variant)' }}>
          Pick a character to join this chat. One member replies per message, taking turns.
        </p>
        {candidates.length === 0 ? (
          <p style={{ margin: '0 0 12px' }} role="status">
            Every character is already in the cast — create more in the Characters tab.
          </p>
        ) : (
          <div className="member-picker" role="listbox" aria-label="Characters">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                className="member-option"
                onClick={() => {
                  void addMember(c.id);
                  onClose();
                }}
              >
                {c.avatar_path ? <img src={c.avatar_path} alt="" /> : <span className="member-option-initial">{c.name.slice(0, 1).toUpperCase()}</span>}
                <span>{c.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="m3-button m3-button-text" onClick={onClose}>
            Cancel
          </button>
        </div>
      </Card>
    </div>
  );
}
