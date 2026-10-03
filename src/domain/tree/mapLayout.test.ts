import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { mapLayout } from './mapLayout';

let seq = 0;
function msg(partial: Partial<Message> & { id: string; parent_id: string | null }): Message {
  seq += 1;
  return {
    chat_id: 'c1',
    ord: seq,
    role: 'assistant',
    content: `msg ${seq}`,
    status: 'complete',
    hidden: false,
    pinned: false,
    created_at: seq,
    updated_at: seq,
    deleted_at: null,
    ...partial,
  } as Message;
}

describe('mapLayout', () => {
  it('lays a linear chain on one row per depth', () => {
    const a = msg({ id: 'a', parent_id: null });
    const b = msg({ id: 'b', parent_id: 'a' });
    const c = msg({ id: 'c', parent_id: 'b' });
    const layout = mapLayout([a, b, c], 'c');
    expect(layout.nodes.map((n) => n.depth)).toEqual([0, 1, 2]);
    expect(layout.cols).toBe(1);
    expect(layout.links).toHaveLength(2);
    expect(layout.nodes.every((n) => n.active)).toBe(true);
  });

  it('places branch siblings side by side and centers the parent', () => {
    const a = msg({ id: 'a', parent_id: null });
    const b = msg({ id: 'b', parent_id: 'a', ord: 0 });
    const c = msg({ id: 'c', parent_id: 'a', ord: 1 });
    const layout = mapLayout([a, b, c], 'b');
    const bx = layout.nodes.find((n) => n.id === 'b')!;
    const cx = layout.nodes.find((n) => n.id === 'c')!;
    const ax = layout.nodes.find((n) => n.id === 'a')!;
    expect(bx.col).toBe(0);
    expect(cx.col).toBe(1);
    expect(ax.col).toBe(0.5);
    expect(bx.active).toBe(true);
    expect(cx.active).toBe(false);
  });

  it('collapses subtrees to the collapsed node', () => {
    const a = msg({ id: 'a', parent_id: null });
    const b = msg({ id: 'b', parent_id: 'a' });
    const c = msg({ id: 'c', parent_id: 'b' });
    const layout = mapLayout([a, b, c], 'c', new Set(['b']));
    expect(layout.nodes).toHaveLength(2); // b's subtree hidden
    expect(layout.links).toHaveLength(1); // a->b only
    expect(layout.nodes.find((n) => n.id === 'b')!.childCount).toBe(1);
  });

  it('counts soft-deleted nodes but keeps them out of the active path', () => {
    const a = msg({ id: 'a', parent_id: null });
    const b = msg({ id: 'b', parent_id: 'a', deleted_at: 123 });
    const layout = mapLayout([a, b], 'a');
    expect(layout.deletedCount).toBe(1);
    const bNode = layout.nodes.find((n) => n.id === 'b')!;
    expect(bNode.deleted).toBe(true);
    expect(bNode.active).toBe(false);
  });

  it('truncates long labels', () => {
    const a = msg({ id: 'a', parent_id: null, content: 'x'.repeat(80) });
    const layout = mapLayout([a], 'a');
    expect(layout.nodes[0]!.label.length).toBeLessThanOrEqual(48);
    expect(layout.nodes[0]!.label.endsWith('…')).toBe(true);
  });
});
