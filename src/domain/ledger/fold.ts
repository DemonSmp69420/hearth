import type { BlockId } from '../prompt/builder';
import { estimator } from '../tokens/estimator';

// ---- Event model (append-only; §9.1) ----

export type LedgerEventType =
  | 'thread_create'
  | 'thread_update'
  | 'thread_merge'
  | 'thread_delete'
  | 'scene_set'
  | 'detector_run';

export interface ThreadPayload {
  /** Stable internal id (uuid); display id is derived at fold time. */
  id: string;
  kind: string;
  title: string;
  detail?: string;
  keywords: string[];
  importance: 1 | 2 | 3;
  status: ThreadStatus;
}

export type ThreadStatus = 'suggested' | 'pending' | 'active' | 'fulfilled' | 'failed' | 'abandoned';

export interface LedgerEventLike {
  id: string;
  anchor_message_id: string;
  seq: number;
  event_type: LedgerEventType;
  payload: string; // JSON
  created_at: number;
}

export interface ThreadView {
  id: string;
  displayId: string;
  kind: string;
  title: string;
  detail: string;
  keywords: string[];
  importance: 1 | 2 | 3;
  status: ThreadStatus;
  originMessageId: string;
  resolutionMessageId: string | null;
  evidence: string | null;
}

export interface SceneState {
  [field: string]: string;
}

export interface LedgerFold {
  threads: ThreadView[];
  scene: SceneState;
  /** Path index of the last detector_run anchor (-1 when never run). */
  lastRunPathIndex: number;
}

/**
 * Branch-aware fold (§9.1): only events anchored on the active path apply,
 * ordered by (path position, seq). Pure — same path in, same state out.
 */
export function foldLedger(
  events: LedgerEventLike[],
  pathIds: string[],
): LedgerFold {
  const indexOf = new Map(pathIds.map((id, i) => [id, i]));
  const onPath = events
    .filter((e) => indexOf.has(e.anchor_message_id))
    .sort((a, b) => {
      const ia = indexOf.get(a.anchor_message_id)!;
      const ib = indexOf.get(b.anchor_message_id)!;
      return ia - ib || a.seq - b.seq;
    });

  const threads = new Map<string, ThreadView>();
  const creationOrder: string[] = [];
  const scene: SceneState = {};
  let lastRunPathIndex = -1;

  for (const event of onPath) {
    const payload = safeParse(event.payload);
    if (!payload) continue;
    switch (event.event_type) {
      case 'thread_create': {
        const t = payload.thread as ThreadPayload | undefined;
        if (!t || !t.id || threads.has(t.id)) break;
        threads.set(t.id, {
          id: t.id,
          displayId: `T${creationOrder.length + 1}`,
          kind: t.kind ?? 'quest',
          title: t.title ?? 'Untitled thread',
          detail: t.detail ?? '',
          keywords: Array.isArray(t.keywords) ? t.keywords : [],
          importance: (t.importance ?? 2) as 1 | 2 | 3,
          status: t.status ?? 'pending',
          originMessageId: event.anchor_message_id,
          resolutionMessageId: null,
          evidence: null,
        });
        creationOrder.push(t.id);
        break;
      }
      case 'thread_update': {
        const thread = threads.get(String(payload.threadId ?? ''));
        if (!thread) break;
        if (payload.status) thread.status = payload.status as ThreadStatus;
        if (payload.evidence) thread.evidence = String(payload.evidence);
        if (payload.resolutionMessageId) thread.resolutionMessageId = String(payload.resolutionMessageId);
        break;
      }
      case 'thread_delete': {
        threads.delete(String(payload.threadId ?? ''));
        break;
      }
      case 'scene_set': {
        if (payload.field) scene[String(payload.field)] = String(payload.value ?? '');
        break;
      }
      case 'detector_run': {
        lastRunPathIndex = indexOf.get(event.anchor_message_id)!;
        break;
      }
      default:
        break;
    }
  }

  return { threads: [...threads.values()], scene, lastRunPathIndex };
}

/** Display ids (T1, T2, …) ordered by creation position along the path. */
export function threadsForDisplay(fold: LedgerFold): ThreadView[] {
  return [...fold.threads].sort((a, b) => a.displayId.localeCompare(b.displayId, undefined, { numeric: true }));
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---- Injection (§9.4): open threads only, hard token cap ----

export interface LedgerInjection {
  content: string;
  included: ThreadView[];
  dropped: ThreadView[];
}

const STATUS_RANK: Record<ThreadStatus, number> = {
  suggested: 0,
  abandoned: 0,
  failed: 0,
  fulfilled: 0,
  pending: 1,
  active: 2,
};

/**
 * Open threads (pending/active) only, ranked by importance → keyword
 * relevance to the recent text → display order, under a hard token cap.
 */
export function buildLedgerBlock(
  fold: LedgerFold,
  recentText: string,
  capTokens = 200,
): LedgerInjection {
  const open = fold.threads
    .filter((t) => STATUS_RANK[t.status] > 0)
    .map((t) => ({
      thread: t,
      relevance: t.keywords.filter((k) => recentText.toLowerCase().includes(k.toLowerCase())).length,
    }))
    .sort(
      (a, b) =>
        b.thread.importance - a.thread.importance ||
        b.relevance - a.relevance ||
        a.thread.displayId.localeCompare(b.thread.displayId, undefined, { numeric: true }),
    );

  const lines: string[] = [];
  const included: ThreadView[] = [];
  const dropped: ThreadView[] = [];
  let tokens = 0;
  for (const { thread } of open) {
    const line = `${thread.displayId} ${thread.title} (${thread.kind}, ${thread.status})`;
    const lineTokens = estimator.estimate(line);
    if (tokens + lineTokens > capTokens) {
      dropped.push(thread);
      continue;
    }
    tokens += lineTokens;
    lines.push(line);
    included.push(thread);
  }

  return {
    content: lines.length > 0 ? `[Open threads]\n${lines.join(' · ')}` : '',
    included,
    dropped,
  };
}

/** Block id for the builder's ledger block (M3). */
export const LEDGER_BLOCK_ID: BlockId = 'lore';
