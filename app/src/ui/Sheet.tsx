import { type ReactNode, useRef, useState } from 'react';
import { Icon } from './icons';
import { DRAG_PX, nearestSnap, PEEK_PX, rubberBand, type Snap, snapHeights } from './sheetSnap';

export function Sheet({ phone, snap, onSnap, title, top, fab, children }: {
  phone: boolean;
  snap: Snap;
  onSnap: (s: Snap) => void;
  /** the handle's one line: route time and distance, or what the sheet holds */
  title: string;
  /** desktop: the search box or directions card, at the top of the panel */
  top?: ReactNode;
  /** phone: round buttons that ride on the sheet's top edge */
  fab?: ReactNode;
  children: ReactNode;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  // where the drag began, and the last two pointer samples for the release speed
  const start = useRef<{ y: number; h: number; moved: boolean; last: { y: number; t: number }; prev: { y: number; t: number } } | null>(null);
  const dragged = useRef(false);
  const screen = () => window.innerHeight;
  const toggle = () => onSnap(snap === 'peek' ? 'half' : 'peek');

  if (!phone) {
    const open = snap !== 'peek';
    return (
      <aside className={open ? 'sheet side' : 'sheet side collapsed'}>
        {top}
        {open && <div className="sheet-body">{children}</div>}
        <button type="button" className="side-toggle" aria-expanded={open} aria-label={open ? 'Collapse side panel' : 'Expand side panel'} onClick={toggle}>
          <Icon name={open ? 'chevronLeft' : 'chevronRight'} />
        </button>
      </aside>
    );
  }

  return (
    <aside className={`sheet bottom ${snap}`} style={drag !== null ? { height: drag } : undefined}>
      {fab && <div className="fabs">{fab}</div>}
      <div
        className="sheet-grip"
        onPointerDown={(e) => {
          const p = { y: e.clientY, t: performance.now() };
          start.current = { y: e.clientY, h: snapHeights(screen())[snap], moved: false, last: p, prev: p };
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dy = s.y - e.clientY;
          if (Math.abs(dy) > DRAG_PX) s.moved = true;
          s.prev = s.last;
          s.last = { y: e.clientY, t: performance.now() };
          const h = snapHeights(screen());
          if (s.moved) setDrag(rubberBand(s.h + dy, PEEK_PX, h.full));
        }}
        onPointerUp={() => {
          const s = start.current;
          start.current = null;
          dragged.current = !!s?.moved;
          if (s?.moved && drag !== null) {
            const dt = (s.last.t - s.prev.t) / 1000;
            onSnap(nearestSnap(drag, screen(), dt > 0 ? (s.prev.y - s.last.y) / dt : 0));
          }
          setDrag(null);
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}
      >
        <button
          type="button" className="sheet-handle" aria-expanded={snap !== 'peek'} aria-label={title}
          // a drag ends with a click on the handle: only a tap toggles
          onClick={() => {
            if (dragged.current) dragged.current = false;
            else toggle();
          }}
        >
          {/* open, the sheet's own heading names it */}
          {snap === 'peek' ? title : ''}
        </button>
      </div>
      <div className="sheet-body">{children}</div>
    </aside>
  );
}
