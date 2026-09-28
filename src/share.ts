// The simulation settings as URL parameters, so a setup can be shared as a link.
// Only values that differ from the defaults are written, e.g. ?alpha=12&speed=35&view=2d.
import type { Show } from './view';

export type ViewMode = '2d' | '3d';

/** Allowed ranges, the same as the sliders. */
export const RANGES = {
  thickness: [1, 25],
  camber: [-10, 12],
  flap: [0, 40],
  alpha: [-20, 25],
  speed: [0, 250],
  altitude: [0, 12000],
  area: [1, 130],
  /** Aspect ratio. */
  ar: [4, 30],
  mass: [100, 100000],
} as const satisfies Record<string, readonly [number, number]>;

export type NumericSetting = keyof typeof RANGES;

export type Settings = Record<NumericSetting, number> & { level: boolean; show: Show };

const SHOW_KEYS: (keyof Show)[] = ['particles', 'pressure', 'streamlines', 'forces', 'vortices'];
const NUMERIC_KEYS = Object.keys(RANGES) as NumericSetting[];

/** Returns the query string, empty or starting with '?'. */
export function encodeSettings(settings: Settings, view: ViewMode, defaults: Settings, defaultView: ViewMode): string {
  const params = new URLSearchParams();
  for (const key of NUMERIC_KEYS) {
    // In level flight the angle follows from the other settings.
    if (key === 'alpha' && settings.level) continue;
    if (settings[key] !== defaults[key]) params.set(key, String(settings[key]));
  }
  if (settings.level !== defaults.level) params.set('level', settings.level ? '1' : '0');
  if (view !== defaultView) params.set('view', view);
  if (SHOW_KEYS.some(k => settings.show[k] !== defaults.show[k])) {
    params.set('show', SHOW_KEYS.filter(k => settings.show[k]).join(',') || 'none');
  }
  const query = params.toString().replace(/%2C/g, ',');
  return query ? `?${query}` : '';
}

/** Reads what a link sets (location.search); anything missing, malformed or out of range is left out. */
export function decodeSettings(search: string): { settings: Partial<Settings>; view?: ViewMode } {
  const params = new URLSearchParams(search);
  const settings: Partial<Settings> = {};
  for (const key of NUMERIC_KEYS) {
    const [min, max] = RANGES[key];
    const raw = params.get(key);
    const value = raw === null || raw.trim() === '' ? NaN : Number(raw);
    if (Number.isFinite(value)) settings[key] = Math.min(max, Math.max(min, value));
  }
  const level = params.get('level');
  if (level === '1' || level === '0') settings.level = level === '1';
  const show = params.get('show');
  if (show !== null) {
    const on = new Set(show.split(','));
    settings.show = Object.fromEntries(SHOW_KEYS.map(k => [k, on.has(k)])) as unknown as Show;
  }
  const view = params.get('view');
  return { settings, view: view === '2d' || view === '3d' ? view : undefined };
}
