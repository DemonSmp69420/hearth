import type { Message } from '../types';

/**
 * Pure tree operations over an in-memory snapshot of a chat's messages.
 * The DB stays the source of truth; these functions never mutate their input.
 * Invariants (ARCHITECTURE §6.3): one implicit root (parent_id NULL),
 * siblings ordered by `ord`, soft deletes hide nodes but never destroy them.
 */

/** Visible (non-deleted) children of a node, ordered by `ord`. */
export function childrenOf(messages: Message[], parentId: string | null): Message[] {
  return messages
    .filter((m) => m.parent_id === parentId && m.deleted_at === null)
    .sort((a, b) => a.ord - b.ord);
}

/** All siblings of a message (including itself), visible only. */
export function siblingsOf(messages: Message[], message: Message): Message[] {
  return childrenOf(messages, message.parent_id);
}

/**
 * Active path root→leaf, walking parents from `leafId`.
 * Skips soft-deleted ancestors (their children remain reachable).
 * Cycle-guarded: a malformed store yields the collected path, never a hang.
 */
export function activePath(messages: Message[], leafId: string | null): Message[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const chain: Message[] = [];
  const seen = new Set<string>();
  let cursor: string | null = leafId;
  while (cursor) {
    if (seen.has(cursor)) break; // cycle tripwire
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    if (node.deleted_at === null) chain.push(node);
    cursor = node.parent_id;
  }
  return chain.reverse();
}

/**
 * The leaf to activate after switching to `node`: follow the last visible
 * child repeatedly (the most recent storyline on that subtree).
 */
export function deepestLeaf(messages: Message[], node: Message): Message {
  let current = node;
  for (;;) {
    const kids = childrenOf(messages, current.id);
    if (kids.length === 0) return current;
    current = kids[kids.length - 1]!;
  }
}

/** Next sibling ord under a parent. */
export function nextOrd(messages: Message[], parentId: string | null): number {
  const kids = messages.filter((m) => m.parent_id === parentId);
  return kids.reduce((max, m) => Math.max(max, m.ord), -1) + 1;
}

/** Every strict descendant id of `nodeId` (deleted included). */
export function descendantIds(messages: Message[], nodeId: string): string[] {
  const out: string[] = [];
  const queue = messages.filter((m) => m.parent_id === nodeId).map((m) => m.id);
  while (queue.length) {
    const id = queue.pop()!;
    out.push(id);
    for (const child of messages) if (child.parent_id === id) queue.push(child.id);
  }
  return out;
}

/**
 * Leaf to activate after deleting a node on the active path: the nearest
 * surviving ancestor.
 */
export function nearestSurvivingAncestor(messages: Message[], nodeId: string): Message | null {
  const byId = new Map(messages.map((m) => [m.id, m]));
  let cursor = byId.get(nodeId)?.parent_id ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) return null;
    if (node.deleted_at === null) return node;
    cursor = node.parent_id;
  }
  return null;
}
