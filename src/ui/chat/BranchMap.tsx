import { useMemo, useRef, useState } from 'react';
import { useChat } from '../../stores/chat';
import { mapLayout, type MapNode } from '../../domain/tree/mapLayout';

const COL_W = 96;
const ROW_H = 62;
const NODE_W = 84;
const NODE_H = 40;

/**
 * Branch Map (M4.1): SVG tree of the whole chat — click to jump, right-click
 * to prune a branch (with undo), drag to pan, wheel to zoom. Soft-deleted
 * nodes render grayed; "prune permanently" destroys them for real (F5/D-005).
 */
export function BranchMap({ onClose }: { onClose: () => void }) {
  const messages = useChat((s) => s.messages);
  const activeLeafId = useChat((s) => s.activeLeafId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [menu, setMenu] = useState<{ node: MapNode; x: number; y: number } | null>(null);
  const [undoIds, setUndoIds] = useState<string[] | null>(null);
  const [confirmPrune, setConfirmPrune] = useState(false);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const layout = useMemo(
    () => mapLayout(messages, activeLeafId, collapsed),
    [messages, activeLeafId, collapsed],
  );

  const contentW = Math.max((layout.cols - 1) * COL_W + NODE_W, 320);
  const contentH = Math.max((layout.maxDepth + 1) * ROW_H, 200);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const jump = (id: string) => {
    void useChat.getState().jumpToNode(id);
    setMenu(null);
  };

  const prune = (id: string) => {
    void useChat.getState().pruneBranch(id).then((ids) => setUndoIds(ids));
    setMenu(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(2.5, Math.max(0.25, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  };

  const nodeFill = (n: MapNode): string => {
    if (n.deleted) return 'var(--md-sys-color-outline-variant)';
    if (n.active) return 'var(--md-sys-color-primary)';
    if (n.role === 'user') return 'var(--md-sys-color-tertiary)';
    return 'var(--md-sys-color-secondary)';
  };

  return (
    <div className="proxy-backdrop" role="dialog" aria-label="Branch map" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="branch-map">
        <header className="branch-map-header">
          <strong>Branch map</strong>
          <span className="branch-map-hint">click = jump · double-click = collapse · right-click = prune · drag = pan · wheel = zoom</span>
          <div style={{ flex: 1 }} />
          {layout.deletedCount > 0 && (
            <button
              type="button"
              className="m3-button m3-button-text branch-map-danger"
              onClick={() => setConfirmPrune(true)}
            >
              Prune permanently ({layout.deletedCount})
            </button>
          )}
          <button type="button" className="m3-button m3-button-text" onClick={onClose} aria-label="Close branch map">
            ✕
          </button>
        </header>

        <div
          className="branch-map-canvas"
          onWheel={onWheel}
          onPointerDown={(e) => {
            dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
            (e.target as Element).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (d) setPan({ x: d.panX + (e.clientX - d.x), y: d.panY + (e.clientY - d.y) });
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${contentW} ${contentH}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            {layout.links.map((l) => {
              const from = layout.nodes.find((n) => n.id === l.from)!;
              const to = layout.nodes.find((n) => n.id === l.to)!;
              const x1 = from.col * COL_W + NODE_W / 2;
              const y1 = from.depth * ROW_H + NODE_H;
              const x2 = to.col * COL_W + NODE_W / 2;
              const y2 = to.depth * ROW_H;
              return (
                <path
                  key={`${l.from}-${l.to}`}
                  d={`M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={l.active ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline-variant)'}
                  strokeWidth={l.active ? 2 : 1}
                />
              );
            })}
            {layout.nodes.map((n) => {
              const x = n.col * COL_W;
              const y = n.depth * ROW_H;
              return (
                <g
                  key={n.id}
                  transform={`translate(${x}, ${y})`}
                  className="branch-map-node"
                  opacity={n.deleted ? 0.45 : 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    jump(n.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (n.childCount > 0) toggleCollapse(n.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenu({ node: n, x: e.clientX, y: e.clientY });
                  }}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={10}
                    fill={nodeFill(n)}
                    stroke={n.bookmarked ? 'var(--md-sys-color-tertiary)' : 'transparent'}
                    strokeWidth={2}
                  />
                  <text x={NODE_W / 2} y={15} textAnchor="middle" fontSize={9} fill="var(--md-sys-color-on-primary)" opacity={0.85}>
                    {n.role}{n.childCount > 0 && collapsed.has(n.id) ? ` (+${n.childCount})` : ''}
                  </text>
                  <text x={NODE_W / 2} y={29} textAnchor="middle" fontSize={9.5} fill="var(--md-sys-color-on-primary)">
                    {n.label.slice(0, 18) || '(empty)'}
                  </text>
                  <title>{`${n.label}\n${n.role} · ${n.deleted ? 'deleted' : n.active ? 'on active path' : 'alternate branch'}`}</title>
                </g>
              );
            })}
          </svg>
        </div>

        {undoIds && (
          <footer className="branch-map-undo">
            <span>Branch deleted ({undoIds.length} messages)</span>
            <button
              type="button"
              className="m3-button m3-button-text"
              onClick={() => {
                void useChat.getState().undoPrune(undoIds);
                setUndoIds(null);
              }}
            >
              Undo
            </button>
            <button type="button" className="m3-button m3-button-text" onClick={() => setUndoIds(null)} aria-label="Dismiss">
              ✕
            </button>
          </footer>
        )}

        {confirmPrune && (
          <footer className="branch-map-undo">
            <span>Permanently delete {layout.deletedCount} messages? This cannot be undone.</span>
            <button
              type="button"
              className="m3-button m3-button-text branch-map-danger"
              onClick={() => {
                void useChat.getState().prunePermanently();
                setConfirmPrune(false);
              }}
            >
              Delete forever
            </button>
            <button type="button" className="m3-button m3-button-text" onClick={() => setConfirmPrune(false)} aria-label="Cancel">
              ✕
            </button>
          </footer>
        )}

        {menu && (
          <div className="branch-map-menu" style={{ left: menu.x, top: menu.y }} role="menu">
            <button type="button" role="menuitem" onClick={() => jump(menu.node.id)}>
              Jump here
            </button>
            <button type="button" role="menuitem" disabled={menu.node.deleted} onClick={() => prune(menu.node.id)}>
              Delete branch{menu.node.childCount > 0 ? ` (+${menu.node.childCount})` : ''}
            </button>
            <button type="button" role="menuitem" disabled={menu.node.childCount === 0} onClick={() => { toggleCollapse(menu.node.id); setMenu(null); }}>
              {collapsed.has(menu.node.id) ? 'Expand subtree' : 'Collapse subtree'}
            </button>
            <button type="button" role="menuitem" onClick={() => setMenu(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
