import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addBadges, BADGES, badgeSvg, imageId, loadBadges, resetBadges } from './sprites';

class FakeImg {
  onload: (() => void) | null = null;
  src = '';
}

beforeEach(() => resetBadges());

describe('badges', () => {
  it('draws each kind in its shape, with a dark glyph on the amber lock', () => {
    expect(badgeSvg('marina')).toContain('<circle cx="13" cy="13" r="12" fill="#1d6fd8"');
    expect(badgeSvg('lock')).toContain('rx="6" fill="#e0a100"');
    expect(badgeSvg('lock')).toContain('stroke="#1b1b1b"');
    expect(badgeSvg('wreck')).toContain('<path d="M13 0.5');
    expect(badgeSvg('wreck')).toContain('scale(0.5)');
    expect(badgeSvg('fuel')).toContain('width="52"');
    expect(imageId('fuel')).toBe('poi-fuel');
  });

  it('decodes every badge once and adds those ready to each map, once', () => {
    const imgs: FakeImg[] = [];
    const make = () => { const i = new FakeImg(); imgs.push(i); return i as unknown as HTMLImageElement; };
    const first = vi.fn(), second = vi.fn();
    const stop = loadBadges(first, make);
    loadBadges(second, make); // already started: only listens
    expect(imgs).toHaveLength(Object.keys(BADGES).length);
    expect(imgs[0].src).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
    const map = { ids: {} as Record<string, unknown>, hasImage(id: string) { return id in this.ids; }, addImage: vi.fn(function (this: { ids: Record<string, unknown> }, id: string) { this.ids[id] = 1; }) };
    addBadges(map);
    expect(map.addImage).not.toHaveBeenCalled();
    imgs[0].onload!();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    stop();
    imgs[1].onload!();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    addBadges(map);
    addBadges(map);
    expect(map.addImage).toHaveBeenCalledTimes(2);
    expect(map.addImage).toHaveBeenCalledWith('poi-marina', imgs[0], { pixelRatio: 2 });
  });

  it('makes real images by default', () => {
    expect(() => loadBadges(() => {})).not.toThrow();
  });
});
