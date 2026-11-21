import { useState } from 'react';
import type { Notice } from './routeNotices';

const MARK = { error: '⛔', warn: '⚠', info: 'ℹ' };

/** The most serious notice as a card; the others fold under it. */
export function Notices({ notices }: { notices: Notice[] }) {
  const [open, setOpen] = useState(false);
  if (!notices.length) return null;
  const [first, ...rest] = notices;
  const shown = open ? notices : [first];
  const more = rest.length + (first.items?.length ?? 0);
  return (
    <section className={`notices ${first.level}`} aria-label="Notices">
      <ul>
        {shown.map((n, i) => (
          <li key={i} className={`notice ${n.level}`}>
            <span className="notice-mark" aria-hidden="true">{MARK[n.level]}</span>
            <div>
              <div className="notice-title">{n.title}</div>
              {n.detail && <div className="small">{n.detail}</div>}
              {open && n.items && <ul className="small notice-items">{n.items.map((t) => <li key={t}>{t}</li>)}</ul>}
            </div>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button type="button" className="notice-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : `+ ${more} more ${more === 1 ? 'note' : 'notes'}`}
        </button>
      )}
    </section>
  );
}
