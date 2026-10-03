import type { Message } from '../types';

export interface MapNode {
  id: string;
  role: Message['role'];
  label: string;
  depth: number;
  /** Column index (unitless); multiply by COL_W when rendering. */
  col: number;
  /** Active-path node. */
  active: boolean;
  deleted: boolean;
  bookmarked: boolean;
  childCount: number;
}

export interface MapLink {
  from: string;
  to: string;
  active: boolean;
}

export interface MapLayout {
  nodes: MapNode[];
  links: MapLink[];
  cols: number;
  maxDepth: number;
  deletedCount: number;
}

/**
 * Tidy horizontal tree layout: leaves packed left→right in `ord` order,
 * parents centered over their children, depth = row. `collapsed` hides
 * whole subtrees beneath those ids (the collapsed node itself stays).
 * Deleted nodes are laid out too (grayed in the UI) so the permanent-prune
 * count stays honest; they never join the active path.
 */
export function mapLayout(
  messages: Message[],
  activeLeafId: string | null,
  collapsed: ReadonlySet<string> = new Set(),
): MapLayout {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const kidsOf = new Map<string | null, Message[]>();
  for (const m of messages) {
    const list = kidsOf.get(m.parent_id) ?? [];
    list.push(m);
    kidsOf.set(m.parent_id, list);
  }
  for (const list of kidsOf.values()) list.sort((a, b) => a.ord - b.ord);

  const activeSet = new Set<string>();
  let cursor: string | null = activeLeafId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    activeSet.add(cursor);
    cursor = byId.get(cursor)?.parent_id ?? null;
  }

  const nodes: MapNode[] = [];
  const links: MapLink[] = [];
  let nextCol = 0;
  let maxDepth = 0;
  let deletedCount = 0;

  const walk = (m: Message, depth: number): number => {
    if (m.deleted_at !== null) deletedCount += 1;
    maxDepth = Math.max(maxDepth, depth);

    const kids = kidsOf.get(m.id) ?? [];
    const collapsedHere = collapsed.has(m.id);

    let col: number;
    if (collapsedHere || kids.length === 0) {
      col = nextCol++;
    } else {
      const kidCols = kids.map((k) => walk(k, depth + 1));
      col = (Math.min(...kidCols) + Math.max(...kidCols)) / 2;
      for (const k of kids) links.push({ from: m.id, to: k.id, active: activeSet.has(m.id) && activeSet.has(k.id) });
    }

    nodes.push({
      id: m.id,
      role: m.role,
      label: firstLine(m.content),
      depth,
      col,
      active: activeSet.has(m.id),
      deleted: m.deleted_at !== null,
      bookmarked: Boolean(m.pinned),
      childCount: kids.length,
    });
    return col;
  };

  for (const root of kidsOf.get(null) ?? []) walk(root, 0);

  nodes.sort((a, b) => a.depth - b.depth || a.col - b.col);
  return { nodes, links, cols: nextCol, maxDepth, deletedCount };
}

function firstLine(content: string): string {
  const line = content.split('\n', 1)[0] ?? '';
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}
