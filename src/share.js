// The simulation settings as URL parameters, so a setup can be shared as a link.
// Only values that differ from the defaults are written, e.g. ?alpha=12&speed=35&view=2d.

/** @typedef {import('./view.js').Show} Show */
/**
 * @typedef {object} Settings
 * @property {number} thickness
 * @property {number} camber
 * @property {number} flap
 * @property {number} alpha
 * @property {number} speed
 * @property {number} altitude
 * @property {number} area
 * @property {number} ar aspect ratio
 * @property {number} mass
 * @property {boolean} level
 * @property {Show} show
 */

/** Allowed ranges, the same as the sliders. */
export const RANGES = {
  thickness: [1, 25],
  camber: [-10, 12],
  flap: [0, 40],
  alpha: [-20, 25],
  speed: [0, 250],
  altitude: [0, 12000],
  area: [1, 130],
  ar: [4, 30],
  mass: [100, 100000],
};

const SHOW_KEYS = /** @type {(keyof Show)[]} */ (['particles', 'pressure', 'streamlines', 'forces', 'vortices']);

/**
 * @param {Settings} settings
 * @param {'2d' | '3d'} view
 * @param {Settings} defaults
 * @param {'2d' | '3d'} defaultView
 * @returns {string} query string, empty or starting with '?'
 */
export function encodeSettings(settings, view, defaults, defaultView) {
  const params = new URLSearchParams();
  for (const key of /** @type {(keyof typeof RANGES)[]} */ (Object.keys(RANGES))) {
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

/**
 * Reads what a link sets; anything missing, malformed or out of range is left out.
 * @param {string} search location.search
 * @returns {{ settings: Partial<Settings>, view?: '2d' | '3d' }}
 */
export function decodeSettings(search) {
  const params = new URLSearchParams(search);
  /** @type {Partial<Settings>} */
  const settings = {};
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const raw = params.get(key);
    const value = raw === null || raw.trim() === '' ? NaN : Number(raw);
    if (Number.isFinite(value)) settings[key] = Math.min(max, Math.max(min, value));
  }
  const level = params.get('level');
  if (level === '1' || level === '0') settings.level = level === '1';
  const show = params.get('show');
  if (show !== null) {
    const on = new Set(show.split(','));
    settings.show = /** @type {Show} */ (Object.fromEntries(SHOW_KEYS.map(k => [k, on.has(k)])));
  }
  const view = params.get('view');
  return { settings, view: view === '2d' || view === '3d' ? view : undefined };
}
