import { describe, expect, it } from 'vitest';
import { decodeSettings, encodeSettings } from './share';

const defaults = {
  thickness: 11,
  camber: 5,
  flap: 0,
  alpha: 5,
  speed: 50,
  altitude: 1500,
  area: 16,
  mass: 1100,
  ar: 7.4,
  level: false,
  show: { particles: true, streamlines: false, pressure: true, forces: true, vortices: false },
};
const copy = () => structuredClone(defaults);

describe('encodeSettings', () => {
  it('writes nothing for the defaults', () => {
    expect(encodeSettings(copy(), '3d', defaults, '3d')).toBe('');
  });

  it('writes only what changed', () => {
    const s = { ...copy(), alpha: 12, speed: 35 };
    expect(encodeSettings(s, '2d', defaults, '3d')).toBe('?alpha=12&speed=35&view=2d');
  });

  it('leaves out the angle in level flight, since it is computed', () => {
    const s = { ...copy(), alpha: 7.3, level: true };
    expect(encodeSettings(s, '3d', defaults, '3d')).toBe('?level=1');
  });

  it('lists the display toggles that are on', () => {
    const s = copy();
    s.show.streamlines = true;
    s.show.particles = false;
    expect(encodeSettings(s, '3d', defaults, '3d')).toBe('?show=pressure,streamlines,forces');
    s.show = { particles: false, streamlines: false, pressure: false, forces: false, vortices: false };
    expect(encodeSettings(s, '3d', defaults, '3d')).toBe('?show=none');
  });
});

describe('decodeSettings', () => {
  it('round-trips with encodeSettings', () => {
    const s = {
      ...copy(),
      thickness: 14.5,
      camber: -2,
      flap: 20,
      alpha: -3.4,
      altitude: 9000,
      mass: 93500,
      area: 122.5,
      ar: 9.5,
    };
    s.show.forces = false;
    const { settings, view } = decodeSettings(encodeSettings(s, '2d', defaults, '3d'));
    expect({ ...copy(), ...settings }).toEqual(s);
    expect(view).toBe('2d');
  });

  it('clamps values to the slider ranges', () => {
    expect(decodeSettings('?alpha=90&speed=-5&mass=1').settings).toEqual({ alpha: 25, speed: 0, mass: 100 });
  });

  it('ignores malformed or unknown values', () => {
    expect(decodeSettings('?alpha=abc&speed=&level=yes&view=4d&foo=1')).toEqual({ settings: {}, view: undefined });
  });

  it('turns every toggle off for show=none', () => {
    expect(decodeSettings('?show=none').settings.show).toEqual({
      particles: false,
      pressure: false,
      streamlines: false,
      forces: false,
      vortices: false,
    });
  });
});
