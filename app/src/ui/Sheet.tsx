import { type ReactNode, useRef, useState } from 'react';
import { Icon } from './icons';
import { DRAG_PX, nearestSnap, PEEK_PX, type Snap, snapHeights } from './sheetSnap';

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
  const start = useRef<{ y: number; h: number; moved: boolean } | null>(null);
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
        onPointerDown={(e) => { start.current = { y: e.clientY, h: snapHeights(screen())[snap], moved: false }; }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          const dy = s.y - e.clientY;
          if (Math.abs(dy) > DRAG_PX) s.moved = true;
          if (s.moved) setDrag(Math.max(PEEK_PX, Math.min(screen(), s.h + dy)));
        }}
        onPointerUp={() => {
          const s = start.current;
          start.current = null;
          dragged.current = !!s?.moved;
          if (s?.moved && drag !== null) onSnap(nearestSnap(drag, screen()));
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
