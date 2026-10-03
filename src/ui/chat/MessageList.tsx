import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Chapter, Message } from '../../domain/types';
import { activePath, childrenOf } from '../../domain/tree/tree';
import { foldLedger } from '../../domain/ledger/fold';
import { accentFor } from '../../theme/accent';
import { useChat } from '../../stores/chat';
import { MessageItem, type SpeakerInfo } from './MessageItem';

/** Human-readable ledger chips anchored to each message (§9.5). */
function ledgerChips(
  events: ReturnType<typeof useChat.getState>['ledgerEvents'],
  messages: Message[],
  leafId: string | null,
): Map<string, string[]> {
  const pathIds = activePath(messages, leafId).map((m) => m.id);
  const fold = foldLedger(events, pathIds);
  const titleOf = new Map(fold.threads.map((t) => [t.id, t.title]));
  const chips = new Map<string, string[]>();
  const onPath = new Set(pathIds);
  for (const e of events) {
    if (!onPath.has(e.anchor_message_id) || e.event_type === 'detector_run') continue;
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(e.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    let label: string | null = null;
    if (e.event_type === 'thread_create') {
      const thread = payload?.thread as { title?: string; status?: string } | undefined;
      label = thread?.status === 'suggested' ? `Suggested: ${thread?.title ?? ''}` : `Thread added: ${thread?.title ?? ''}`;
    } else if (e.event_type === 'thread_update') {
      const title = titleOf.get(String(payload?.threadId ?? '')) ?? '';
      if (payload?.status) label = `${payload.status}: ${title}`;
    } else if (e.event_type === 'scene_set') {
      label = `Scene: ${payload?.field} → ${payload?.value}`;
    }
    if (label) {
      const list = chips.get(e.anchor_message_id) ?? [];
      list.push(label);
      chips.set(e.anchor_message_id, list);
    }
  }
  return chips;
}

export function MessageList() {
  const { messages, activeLeafId, stream, ledgerEvents, genSettings, members, character, chapters } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const ledgerEnabled = genSettings.ledger?.enabled !== false;
  const chipsByMessage = useMemo(
    () => (ledgerEnabled ? ledgerChips(ledgerEvents, messages, activeLeafId) : new Map()),
    [ledgerEnabled, ledgerEvents, messages, activeLeafId],
  );

  // M5.2: speaker labels/avatars for group chats (1:1 keeps the plain look).
  const isGroup = members.length > 0;
  const speakerOf = useMemo(() => {
    const map = new Map<string, SpeakerInfo>();
    for (const m of members) {
      map.set(m.character_id, { name: m.name, color: accentFor(m.name).primary, avatar: m.avatar_path });
    }
    if (character) {
      map.set(character.id, {
        name: character.name,
        color: accentFor(character.name).primary,
        avatar: character.avatar_path,
      });
    }
    return map;
  }, [members, character]);

  const path = activePath(messages, activeLeafId);
  // M5.4: chapter dividers — only chapters whose anchor lies on this path.
  const chapterByAnchor = useMemo(() => {
    const pathIds = new Set(path.map((m) => m.id));
    const map = new Map<string, Chapter>();
    for (const c of chapters) {
      if (pathIds.has(c.anchor_message_id)) map.set(c.anchor_message_id, c);
    }
    return map;
  }, [chapters, path]);
  const streamingId = stream?.messageId ?? null;
  // The in-flight reply renders at the end of the path even though the DB row
  // only gets its final content on completion.
  const display: { message: Message; streamText?: string }[] = path.map((m) => ({
    message: m,
    streamText: m.id === streamingId ? stream?.text : undefined,
  }));

  const virtualizer = useVirtualizer({
    count: display.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 120,
    getItemKey: (i) => display[i]?.message.id ?? i,
    overscan: 8,
  });

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    if (pinnedToBottom.current) scrollToBottom();
  }, [display.length, stream?.text.length]);

  return (
    <div
      className="msg-list"
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinnedToBottom.current = el.scrollTop + el.clientHeight > el.scrollHeight - 160;
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const entry = display[item.index];
          if (!entry) return null;
          const siblings = childrenOf(messages, entry.message.parent_id).filter(
            (m) => m.role === entry.message.role,
          ).length;
          const siblingIndex = childrenOf(messages, entry.message.parent_id)
            .filter((m) => m.role === entry.message.role)
            .findIndex((m) => m.id === entry.message.id);
          const speaker =
            isGroup && entry.message.role === 'assistant'
              ? (speakerOf.get(entry.message.speaker_character_id ?? character?.id ?? '') ?? null)
              : null;
          const chapter = item.index > 0 ? chapterByAnchor.get(entry.message.id) : undefined;
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
            >
              {chapter && (
                <div className="chapter-divider" role="separator" aria-label={chapter.title}>
                  <span className="chapter-divider-line" />
                  <span className="chapter-divider-label">{chapter.title}</span>
                  <span className="chapter-divider-line" />
                </div>
              )}
              <MessageItem
                message={entry.message}
                siblings={siblings}
                siblingIndex={Math.max(0, siblingIndex)}
                streamText={entry.streamText}
                chips={chipsByMessage.get(entry.message.id) ?? []}
                speaker={speaker}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
