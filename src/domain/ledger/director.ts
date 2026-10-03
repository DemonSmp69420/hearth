import type { ThreadStatus } from './fold';

/**
 * §9.3 strict JSON contract for the Director sidecar. Hand-validated (no
 * dependency); on failure the caller discards and retries at most once.
 * The model must return {"none": true} when nothing changed.
 */

export interface DirectorNewThread {
  kind: string;
  title: string;
  detail?: string;
  keywords?: string[];
  importance?: number;
  confidence?: number;
}

export interface DirectorUpdate {
  id: string;
  status?: ThreadStatus;
  evidence?: string;
  confidence?: number;
}

export interface DirectorOutput {
  none: boolean;
  new_threads: DirectorNewThread[];
  updates: DirectorUpdate[];
  scene: Record<string, string>;
  memory_suggestions: { scope: string; text: string; confidence?: number }[];
}

const KINDS = new Set([
  'quest',
  'promise',
  'appointment',
  'mystery',
  'obligation',
  'threat',
  'secret',
  'custom',
]);
const STATUSES = new Set(['suggested', 'pending', 'active', 'fulfilled', 'failed', 'abandoned']);

export class ContractError extends Error {}

export function validateDirectorOutput(raw: string): DirectorOutput {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ContractError('Director output is not valid JSON');
  }
  if (typeof value !== 'object' || value === null) {
    throw new ContractError('Director output is not an object');
  }
  const obj = value as Record<string, unknown>;

  // {"none": true} short-circuit
  if (obj.none === true) {
    return { none: true, new_threads: [], updates: [], scene: {}, memory_suggestions: [] };
  }

  const new_threads = arr(obj.new_threads).map((t) => {
    const rec = requireRecord(t, 'new_threads[]');
    const kind = str(rec.kind, 'quest');
    if (!KINDS.has(kind)) throw new ContractError(`unknown thread kind: ${kind}`);
    const title = str(rec.title, '');
    if (!title) throw new ContractError('new thread missing title');
    const importance = num(rec.importance, 2);
    return {
      kind,
      title,
      detail: optStr(rec.detail),
      keywords: arr(rec.keywords).map(String).slice(0, 6),
      importance: (importance >= 3 ? 3 : importance <= 1 ? 1 : 2) as 1 | 2 | 3,
      confidence: num(rec.confidence, 0.5),
    };
  });

  const updates = arr(obj.updates).map((u) => {
    const rec = requireRecord(u, 'updates[]');
    const id = str(rec.id, '');
    if (!id) throw new ContractError('update missing thread id');
    const status = optStr(rec.status);
    if (status && !STATUSES.has(status)) throw new ContractError(`unknown status: ${status}`);
    return {
      id,
      status: (status ?? undefined) as ThreadStatus | undefined,
      evidence: optStr(rec.evidence),
      confidence: num(rec.confidence, 0.5),
    };
  });

  const scene: Record<string, string> = {};
  if (obj.scene !== undefined && obj.scene !== null) {
    if (typeof obj.scene !== 'object' || Array.isArray(obj.scene)) {
      throw new ContractError('scene must be an object');
    }
    for (const [k, v] of Object.entries(obj.scene as Record<string, unknown>).slice(0, 8)) {
      scene[k] = String(v ?? '');
    }
  }

  const memory_suggestions = arr(obj.memory_suggestions).map((m) => {
    const rec = requireRecord(m, 'memory_suggestions[]');
    const text = str(rec.text, '');
    if (!text) throw new ContractError('memory suggestion missing text');
    return { scope: str(rec.scope, 'chat'), text, confidence: num(rec.confidence, 0.5) };
  });

  return {
    none: new_threads.length === 0 && updates.length === 0 && Object.keys(scene).length === 0 && memory_suggestions.length === 0,
    new_threads: new_threads.slice(0, 2), // hard cap §9.2
    updates,
    scene,
    memory_suggestions: memory_suggestions.slice(0, 3),
  };
}

/** Tolerant extractor: finds the first {...} JSON object in a chatty reply. */
export function extractJsonCandidate(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return text;
  return text.slice(start, end + 1);
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function requireRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContractError(`${where} is not an object`);
  }
  return value as Record<string, unknown>;
}
function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
function optStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
