import type { LngLat } from '../graph/geo';
import type { VesselProfile } from '../routing/router';
import { Icon } from './icons';
import type { LocalIndex } from './localSearch';
import { type Point, PointInput } from './PointInput';
import { VESSELS, vesselOf } from './vessels';

export type PickTarget = 'start' | 'end' | 'via' | null;

/** From / to / stops and the boat: the top of the screen while planning, like a maps app's directions card. */
export function DirectionsCard(props: {
  start: Point | null;
  end: Point | null;
  via: Point[];
  picking: PickTarget;
  near?: LngLat;
  local?: LocalIndex;
  profile: VesselProfile;
  customOpen: boolean;
  setStart: (p: Point | null) => void;
  setEnd: (p: Point | null) => void;
  setVia: (v: Point[]) => void;
  setPicking: (t: PickTarget) => void;
  myPosition: (set: (p: Point) => void) => void;
  setProfile: (p: VesselProfile) => void;
  onCustom: () => void;
  onClose: () => void;
  /** a route is shown: one line "A → B", tapped to edit */
  compact?: boolean;
  onEdit?: () => void;
}) {
  const { start, end, via, picking, near, local, profile } = props;
  const toggle = (t: PickTarget) => props.setPicking(picking === t ? null : t);
  const preset = vesselOf(profile);
  if (props.compact) {
    const boat = VESSELS.find((v) => v.id === preset)?.label ?? 'Custom boat';
    return (
      <section className="directions-card dir-compact" aria-label="Directions">
        <button type="button" className="icon-btn" aria-label="Close directions" onClick={props.onClose}><Icon name="back" /></button>
        <button type="button" className="dir-summary" aria-label="Edit route" onClick={props.onEdit}>
          <span>{start?.label} → {end?.label}{via.length ? ` · ${via.length} waypoint${via.length > 1 ? 's' : ''}` : ''} · {boat}</span>
        </button>
      </section>
    );
  }
  return (
    <section className="directions-card" aria-label="Directions">
      <div className="dir-top">
        <button type="button" className="icon-btn" aria-label="Close directions" onClick={props.onClose}><Icon name="back" /></button>
        <div className="dir-fields">
          <PointInput
            label="A" value={start} picking={picking === 'start'} near={near} local={local}
            onPick={() => toggle('start')} onMyPosition={() => props.myPosition(props.setStart)} onSelect={props.setStart}
          />
          {via.length > 0 && (
            <ol className="via">
              {via.map((p, i) => (
                <li key={i}>
                  <span>{p.label}</span>
                  <button type="button" title="Remove waypoint" aria-label="Remove waypoint" onClick={() => props.setVia(via.filter((_, j) => j !== i))}><Icon name="close" size={18} /></button>
                </li>
              ))}
            </ol>
          )}
          <PointInput
            label="B" value={end} picking={picking === 'end'} near={near} local={local}
            onPick={() => toggle('end')} onMyPosition={() => props.myPosition(props.setEnd)} onSelect={props.setEnd}
          />
        </div>
        <button type="button" className="icon-btn swap" title="Swap" aria-label="Swap" onClick={() => { props.setStart(end); props.setEnd(start); }}>
          <Icon name="swap" />
        </button>
      </div>
      <button type="button" className={picking === 'via' ? 'add-stop active' : 'add-stop'} onClick={() => toggle('via')}>
        <Icon name="add" />{picking === 'via' ? 'Click the map to add a waypoint…' : 'Add waypoint'}
      </button>
      <div className="chips vessel-chips" role="toolbar" aria-label="Boat">
        {VESSELS.map((v) => (
          <button key={v.id} type="button" className="chip" aria-pressed={preset === v.id} onClick={() => props.setProfile({ ...profile, ...v.hull })}>
            <Icon name="boat" size={16} />{v.label}
          </button>
        ))}
        <button type="button" className="chip" aria-pressed={props.customOpen || preset === null} onClick={props.onCustom}>Custom…</button>
      </div>
    </section>
  );
}
