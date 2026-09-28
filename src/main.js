import * as Aero from './aero.js';
import * as Scene2D from './scene2d.js';
import { decodeSettings, encodeSettings } from './share.js';
import { createSolver } from './solver.js';

const G = 9.81;
const Q_REF = 0.5 * 1.225 * 50 * 50 * 16;

const I18N = {
  fr: {
    title: "Portance d'une aile",
    subtitle: 'Soufflerie virtuelle',
    help: 'Aide',
    profile: 'Profil',
    pClassic: 'Classique',
    pSymmetric: 'Symétrique',
    pFlat: 'Plaque plane',
    pCambered: 'Très cambré',
    pCustom: 'Personnalisé',
    thickness: 'Épaisseur',
    camber: 'Cambrure',
    flap: 'Volets',
    flight: 'Vol',
    alpha: 'Incidence α',
    speed: 'Vitesse V',
    altitude: 'Altitude',
    area: 'Surface S',
    mass: 'Masse',
    aircraft: 'Avion',
    plGlider: 'Planeur',
    plCessna: 'Cessna 172',
    plPc12: 'Pilatus PC-12',
    plA321: 'Airbus A321',
    level: 'Vol en palier (α automatique)',
    showParticles: 'Particules',
    showStreamlines: 'Lignes de courant',
    showPressure: 'Pression',
    showForces: 'Forces',
    showVortices: 'Tourbillons marginaux',
    stallAlarm: 'Alarme de décrochage',
    results: 'Résultats',
    rCd: 'Cx (traînée)',
    rRho: 'Masse volumique ρ',
    hLd: 'Finesse',
    rQ: 'Pression dynamique q',
    rDrag: 'Traînée',
    rInduced: 'dont traînée induite',
    rSpan: 'Envergure b = √(A · S)',
    ar: 'Allongement A',
    rRes: 'Résultante',
    rMass: 'Masse soutenue',
    chart: 'Courbe Cz(α)',
    stall: 'Décrochage !',
    tooSlow: 'Trop lent pour voler !',
    share: 'Partager',
    copied: 'Lien copié !',
    legLow: 'dépression',
    legHigh: 'surpression',
    hintOrbit: 'Glisser : tourner la vue',
    hintTilt: 'Maj + glisser : incidence',
    hintZoom: 'Molette : zoom · double-clic : recentrer',
    hintScale: "Envergure raccourcie à l'écran",
    hint2d: 'Glisser verticalement ou molette : incidence',
    lift: 'Portance',
    drag: 'Traînée',
    res: 'Résultante',
    weight: 'Poids',
    cl: 'Cz',
    liftSym: 'P',
    caption: (z, s) => `Portance nulle à α = ${z}° · décrochage vers ${s}° · pointillés : profil seul (aile infinie)`,
  },
  en: {
    title: 'Wing lift',
    subtitle: 'Virtual wind tunnel',
    help: 'Help',
    profile: 'Airfoil',
    pClassic: 'Classic',
    pSymmetric: 'Symmetric',
    pFlat: 'Flat plate',
    pCambered: 'High camber',
    pCustom: 'Custom',
    thickness: 'Thickness',
    camber: 'Camber',
    flap: 'Flaps',
    flight: 'Flight',
    alpha: 'Angle of attack α',
    speed: 'Airspeed V',
    altitude: 'Altitude',
    area: 'Wing area S',
    mass: 'Mass',
    aircraft: 'Aircraft',
    plGlider: 'Glider',
    plCessna: 'Cessna 172',
    plPc12: 'Pilatus PC-12',
    plA321: 'Airbus A321',
    level: 'Level flight (automatic α)',
    showParticles: 'Particles',
    showStreamlines: 'Streamlines',
    showPressure: 'Pressure',
    showForces: 'Forces',
    showVortices: 'Tip vortices',
    stallAlarm: 'Stall warning',
    results: 'Results',
    rCd: 'CD (drag)',
    rRho: 'Air density ρ',
    hLd: 'L/D',
    rQ: 'Dynamic pressure q',
    rDrag: 'Drag',
    rInduced: 'of which induced drag',
    rSpan: 'Wingspan b = √(A · S)',
    ar: 'Aspect ratio A',
    rRes: 'Resultant',
    rMass: 'Supported mass',
    chart: 'CL(α) curve',
    stall: 'Stall!',
    tooSlow: 'Too slow to fly!',
    share: 'Share',
    copied: 'Link copied!',
    legLow: 'low pressure',
    legHigh: 'high pressure',
    hintOrbit: 'Drag: rotate the view',
    hintTilt: 'Shift + drag: angle of attack',
    hintZoom: 'Wheel: zoom · double-click: reset',
    hintScale: 'Span shortened on screen',
    hint2d: 'Drag vertically or scroll: angle of attack',
    lift: 'Lift',
    drag: 'Drag',
    res: 'Resultant',
    weight: 'Weight',
    cl: 'CL',
    liftSym: 'L',
    caption: (z, s) => `Zero lift at α = ${z}° · stall around ${s}° · dashed: airfoil alone (infinite wing)`,
  },
};

// Rounded to the slider steps.
// Aspect ratio = span² / area: a long, slender glider wing versus stubbier light aircraft and airliners.
const PLANES = {
  glider: { mass: 600, area: 18, ar: 16 },
  cessna: { mass: 1100, area: 16, ar: 7.4 },
  pc12: { mass: 4750, area: 26, ar: 10.3 },
  a321: { mass: 93500, area: 122.5, ar: 9.5 },
};

// Mass slider is logarithmic (100 kg to 100 t) so a glider and an airliner both get usable resolution.
const MASS_MIN = 100,
  MASS_MAX = 100000;
const massToSlider = m => Math.round((1000 * Math.log(m / MASS_MIN)) / Math.log(MASS_MAX / MASS_MIN));
const sliderToMass = v => {
  const m = MASS_MIN * (MASS_MAX / MASS_MIN) ** (v / 1000);
  const step = m < 1000 ? 10 : m < 10000 ? 50 : 500;
  return Math.round(m / step) * step;
};
const SPEED_MAX = 250;

const state = {
  lang: 'fr',
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
  alarm: false,
  show: { particles: true, streamlines: false, pressure: true, forces: true, vortices: false },
};
const DEFAULTS = structuredClone(state);
const DEFAULT_VIEW = '3d';

// DOM lookups. The ids come from index.html, so their elements are left untyped.
/** @param {string} id @returns {any} */
const $ = id => document.getElementById(id);
/** @param {string} selector @returns {HTMLElement[]} */
const $$ = selector => [...document.querySelectorAll(/** @type {any} */ (selector))];
const stage = $('stage');
let af, aero, flow, clMax;
let time = 0;

const tr = key => I18N[state.lang][key];
const fmt = (n, d = 0) => n.toLocaleString(state.lang, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtForce = n => (Math.abs(n) >= 1000 ? `${fmt(n / 1000, 2)} kN` : `${fmt(n)} N`);
const fmtMass = kg => (Math.abs(kg) >= 1000 ? `${fmt(kg / 1000, 2)} t` : `${fmt(kg)} kg`);

/** Coefficients of the whole wing (lifting line), at a geometric angle of attack. */
const wing = (/** @type {number} */ alpha) => Aero.coefficients(af, alpha, state.ar);

function forces() {
  const rho = Aero.airDensity(state.altitude);
  const q = 0.5 * rho * state.speed ** 2;
  const lift = q * state.area * aero.CL;
  const drag = q * state.area * aero.CD;
  const induced = q * state.area * aero.CDi;
  const span = Math.sqrt(state.ar * state.area);
  const weight = state.mass * G;
  // Slowest speed at which the wing can still carry the weight, at its best angle.
  const vs = clMax > 0 ? Math.sqrt((2 * weight) / (rho * state.area * clMax)) : Infinity;
  return { rho, q, lift, drag, induced, span, res: Math.hypot(lift, drag), weight, vs };
}

// Angle where lift equals weight, searched on the unstalled part of the curve.
function levelAlpha() {
  const f = forces();
  const target = f.q > 0 ? f.weight / (f.q * state.area) : Infinity;
  const ref = wing(0);
  let lo = Math.max(-20, ref.stallNeg),
    hi = Math.min(25, ref.stallPos);
  if (target >= wing(hi).CL) return hi;
  if (target <= wing(lo).CL) return lo;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (wing(mid).CL < target) lo = mid;
    else hi = mid;
  }
  return Math.round(lo * 100) / 100;
}

// ---------- Simulation state ----------

// The shape and its flow are computed in a worker (~0.1 s); the old one stays on screen meanwhile.
const solver = createSolver(result => {
  af = result;
  wingChanged();
  syncLoading();
});

// Maximum lift and every coefficient depend on the aspect ratio as well as on the airfoil.
function wingChanged() {
  if (!af) return;
  clMax = wing(wing(0).stallPos).CL;
  updateAlpha();
}

function updateShape() {
  solver.solve({ thickness: state.thickness, camber: state.camber, flap: state.flap });
}

function updateAlpha() {
  if (!af) return;
  if (state.level) {
    state.alpha = levelAlpha();
    $('alpha').value = state.alpha;
  }
  aero = wing(state.alpha);
  flow = Aero.flowFor(state.alpha);
  scene?.setFlow(af, flow, aero, state.show, state.ar);
  updateAlarm();
  render();
}

// ---------- Stall warning ----------

// Like the real ones, it sounds a little before the stall angle, and keeps going once stalled.
const ALARM_MARGIN = 1;
let alarm = null;

function stallWarning() {
  return aero.stall > 0 || state.alpha >= aero.stallPos - ALARM_MARGIN;
}

// A 1 kHz tone chopped at 5 Hz by a square LFO: bip-bip-bip.
function createAlarm() {
  const ctx = new AudioContext();
  const tone = ctx.createOscillator();
  tone.type = 'square';
  tone.frequency.value = 1000;
  const chop = ctx.createGain();
  chop.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 5;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.5;
  lfo.connect(lfoDepth).connect(chop.gain);
  const volume = ctx.createGain();
  volume.gain.value = 0;
  tone.connect(chop).connect(volume).connect(ctx.destination);
  tone.start();
  lfo.start();
  return { ctx, volume };
}

function updateAlarm() {
  if (!state.alarm || !aero) {
    if (alarm) alarm.volume.gain.setTargetAtTime(0, alarm.ctx.currentTime, 0.01);
    return;
  }
  // Created on the checkbox click: browsers only allow audio after a user gesture.
  if (!alarm) alarm = createAlarm();
  const on = stallWarning() && !document.hidden;
  alarm.volume.gain.setTargetAtTime(on ? 0.06 : 0, alarm.ctx.currentTime, 0.01);
}

function render() {
  if (!af) return;
  drawForces();
  drawChart();
  updateReadouts();
  scheduleUrlUpdate();
}

// ---------- Shareable link: the address bar always holds the current setup ----------

const shareUrl = () =>
  location.origin + location.pathname + encodeSettings(state, state.mode || DEFAULT_VIEW, DEFAULTS, DEFAULT_VIEW);

let urlTimer = 0;
function scheduleUrlUpdate() {
  clearTimeout(urlTimer);
  // replaceState: dragging a slider must not fill the browser history.
  urlTimer = window.setTimeout(() => history.replaceState(null, '', shareUrl()), 300);
}

async function share() {
  const url = shareUrl();
  try {
    // Phones get the system share sheet; desktops copy the link.
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: document.title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    $('shareLabel').textContent = tr('copied');
    setTimeout(() => ($('shareLabel').textContent = tr('share')), 1500);
  } catch {
    /* share sheet dismissed or clipboard refused */
  }
}

// ---------- Stage: 2D or 3D view ----------

/** @type {Record<string, Promise<import('./view.js').View | null>>} */
const scenes = {};
/** @type {import('./view.js').View | null} */
let scene = null;
let tiltFrom = 0;
/** @type {import('./view.js').ViewInput} */
const sceneInput = {
  // Drag distance in pixels, upwards positive, counted from the start of the drag.
  onTilt: (dy, start) => {
    if (start) tiltFrom = state.alpha;
    else setAlpha(tiltFrom + dy * 0.12);
  },
  onNudge: sign => setAlpha(state.alpha + sign * 0.5),
};

// three.js is only downloaded the first time the 3D view is opened.
function sceneFor(mode) {
  if (!(mode in scenes)) {
    scenes[mode] = (mode === '3d' ? import('./scene3d.js') : Promise.resolve(Scene2D))
      .then(module => module.create(stage, sceneInput))
      .catch(() => null);
  }
  return scenes[mode];
}

let modeRequest = 0;
let modeLoading = false;
const syncLoading = () => stage.classList.toggle('loading', modeLoading || !af);
async function setMode(mode) {
  const request = ++modeRequest;
  // Spinner while the view is created; the first 3D switch also downloads three.js.
  modeLoading = true;
  syncLoading();
  let next = await sceneFor(mode);
  // No WebGL, or the 3D code failed to load: stay in 2D.
  if (!next) {
    mode = '2d';
    $$('[data-mode="3d"]').forEach(b => {
      /** @type {HTMLButtonElement} */ (b).disabled = true;
    });
    next = await sceneFor(mode);
  }
  // A later click won while this view was loading.
  if (request !== modeRequest) {
    next.setActive(next === scene);
    return;
  }
  if (scene && scene !== next) scene.setActive(false);
  scene = next;
  scene.setActive(true);
  state.mode = mode;
  stage.dataset.mode = mode;
  $$('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  try {
    localStorage.setItem('view', mode);
  } catch {
    /* storage unavailable */
  }
  if (af) scene.setFlow(af, flow, aero, state.show, state.ar);
  scene.resize();
  if (af) drawForces();
  modeLoading = false;
  syncLoading();
  scheduleUrlUpdate();
}

function drawForces() {
  if (!scene) return;
  scene.updateAngle(state.alpha, `α = ${fmt(state.alpha, 1)}°`);
  // Arrow length in lift coefficient units, relative to 50 m/s and 16 m².
  const f = forces();
  scene.updateForces(f, 1 / Q_REF, {
    lift: `${tr('lift')} ${fmtForce(f.lift)}`,
    res: `${tr('res')} ${fmtForce(f.res)}`,
    drag: `${tr('drag')} ${fmtForce(f.drag)}`,
    weight: `${tr('weight')} ${fmtForce(f.weight)}`,
  });
}

// ---------- Panel ----------

function drawChart() {
  const W = 300,
    H = 170,
    L = 30,
    R = 8,
    T = 8,
    B = 20;
  const A0 = -20,
    A1 = 25,
    C0 = -1.6,
    // Room for the higher maximum lift with flaps.
    C1 = Math.max(2.4, clMax + 0.4);
  const X = a => L + ((a - A0) / (A1 - A0)) * (W - L - R);
  const Y = c => T + ((C1 - c) / (C1 - C0)) * (H - T - B);

  let s = '';
  s += `<rect class="zone" x="${X(Math.min(A1, aero.stallPos))}" y="${T}" width="${Math.max(0, X(A1) - X(aero.stallPos))}" height="${H - T - B}"/>`;
  s += `<rect class="zone" x="${X(A0)}" y="${T}" width="${Math.max(0, X(aero.stallNeg) - X(A0))}" height="${H - T - B}"/>`;
  for (const a of [-20, -10, 0, 10, 20]) {
    s += `<line class="${a ? 'grid' : 'axis'}" x1="${X(a)}" x2="${X(a)}" y1="${T}" y2="${H - B}"/>`;
    s += `<text x="${X(a)}" y="${H - 6}" text-anchor="middle">${a}°</text>`;
  }
  for (let c = -1; c <= C1 - 0.2; c++) {
    s += `<line class="${c ? 'grid' : 'axis'}" x1="${L}" x2="${W - R}" y1="${Y(c)}" y2="${Y(c)}"/>`;
    s += `<text x="${L - 5}" y="${Y(c) + 3}" text-anchor="end">${c}</text>`;
  }

  // Dashed: the airfoil section (infinite wing). Solid: this wing, which lifts less per degree.
  const pts = [],
    sectionPts = [];
  for (let a = A0; a <= A1; a += 0.5) {
    const cl = Math.max(C0, Math.min(C1, Aero.sectionCoefficients(af, a).CL));
    sectionPts.push(`${X(a).toFixed(1)},${Y(cl).toFixed(1)}`);
    pts.push(`${X(a).toFixed(1)},${Y(wing(a).CL).toFixed(1)}`);
  }
  s += `<polyline class="section-curve" points="${sectionPts.join(' ')}"/>`;
  s += `<polyline class="curve" points="${pts.join(' ')}"/>`;
  s += `<text x="${L + 4}" y="${T + 10}">${tr('cl')}</text><text x="${W - R - 2}" y="${Y(0) - 4}" text-anchor="end">α</text>`;

  // Lift coefficient needed to carry the weight at the current speed.
  const f = forces();
  const clReq = f.q > 0 ? f.weight / (f.q * state.area) : Infinity;
  if (clReq <= C1) s += `<line class="req" x1="${L}" x2="${W - R}" y1="${Y(clReq)}" y2="${Y(clReq)}"/>`;

  const cx = X(state.alpha),
    cy = Y(aero.CL);
  s += `<line class="guide" x1="${cx}" x2="${cx}" y1="${H - B}" y2="${cy}"/>`;
  s += `<circle class="dot" cx="${cx}" cy="${cy}" r="5"/>`;
  $('chart').innerHTML = s;

  $('chartCaption').textContent = tr('caption')(fmt(aero.zeroLift, 1), fmt(aero.stallPos, 1));
}

function updateReadouts() {
  const f = forces();
  $('outThickness').textContent = `${fmt(state.thickness, 1)} %`;
  $('outCamber').textContent = `${fmt(state.camber, 1)} %`;
  $('outFlap').textContent = `${fmt(state.flap)}°`;
  $('outAlpha').textContent = `${fmt(state.alpha, 1)}°`;
  $('outSpeed').textContent = `${fmt(state.speed)} m/s · ${fmt(state.speed * 3.6)} km/h`;
  $('outAltitude').textContent = `${fmt(state.altitude)} m`;
  $('outArea').textContent = `${fmt(state.area, 1)} m²`;
  $('outAr').textContent = fmt(state.ar, 1);
  $('outMass').textContent = fmtMass(state.mass);

  const hasVs = Number.isFinite(f.vs);
  $('hCl').textContent = fmt(aero.CL, 2);
  $('hLd').textContent = fmt(aero.CL / aero.CD, 1);
  $('hLift').textContent = fmtForce(f.lift);
  $('hWeight').textContent = fmtForce(f.weight);
  $('hVs').textContent = hasVs ? `${fmt(f.vs)} m/s` : '—';

  $('rCd').textContent = fmt(aero.CD, 3);
  $('rRho').textContent = `${fmt(f.rho, 3)} kg/m³`;
  $('rQ').textContent = `${fmt(f.q)} Pa`;
  $('rDrag').textContent = fmtForce(f.drag);
  $('rInduced').textContent = fmtForce(f.induced);
  $('rSpan').textContent = `${fmt(f.span, 1)} m`;
  $('rRes').textContent = fmtForce(f.res);
  $('rMass').textContent = fmtMass(f.lift / G);

  $('formula').textContent =
    `${tr('liftSym')} = ½ · ρ · V² · S · ${tr('cl')}\n` +
    `= ½ · ${fmt(f.rho, 3)} · ${fmt(state.speed)}² · ${fmt(state.area, 1)} · ${fmt(aero.CL, 2)}\n` +
    `≈ ${fmtForce(f.lift)}`;
  $('formulaVs').textContent =
    `Vₛ = √(2 · m · g / (ρ · S · ${tr('cl')}max))\n` +
    `= √(2 · ${fmt(state.mass)} · ${fmt(G, 2)} / (${fmt(f.rho, 3)} · ${fmt(state.area, 1)} · ${fmt(clMax, 2)}))\n` +
    `≈ ${hasVs ? fmt(f.vs) + ' m/s' : '∞'}`;

  const slow = state.speed < f.vs;
  $('slowBadge').classList.toggle('on', slow);
  const zone = $('vsZone');
  zone.hidden = !hasVs;
  zone.style.width = `calc((100% - 16px) * ${Math.min(1, f.vs / SPEED_MAX)})`;

  $('stallBadge').classList.toggle('on', aero.stall > 0);
  updatePresetUI();
}

function updatePresetUI() {
  let current = 'custom';
  for (const [name, p] of Object.entries(Aero.PRESETS)) {
    if (p.thickness === state.thickness && p.camber === state.camber) current = name;
  }
  $('preset').value = current;

  let plane = 'custom';
  for (const [name, p] of Object.entries(PLANES)) {
    if (p.mass === state.mass && p.area === state.area && p.ar === state.ar) plane = name;
  }
  $('plane').value = plane;
}

function applyLanguage() {
  document.documentElement.lang = state.lang;
  $$('[data-i18n]').forEach(el => {
    el.textContent = tr(el.dataset.i18n);
  });
  $$('[data-lang]').forEach(b => b.classList.toggle('active', b.dataset.lang === state.lang));
  document.title = tr('title');
  try {
    localStorage.setItem('lang', state.lang);
  } catch {
    /* storage unavailable */
  }
  render();
}

// ---------- Wiring ----------

function setLevel(on) {
  state.level = on;
  $('level').checked = on;
}

// Speed, density, area and mass change the angle needed for level flight.
const flightChanged = () => (state.level ? updateAlpha() : render());

function setAlpha(value) {
  setLevel(false);
  state.alpha = Math.round(Math.max(-20, Math.min(25, value)) * 10) / 10;
  $('alpha').value = state.alpha;
  updateAlpha();
}

function bindControls() {
  const ranges = {
    thickness: updateShape,
    camber: updateShape,
    flap: updateShape,
    alpha: () => {
      setLevel(false);
      updateAlpha();
    },
    speed: flightChanged,
    altitude: flightChanged,
    area: flightChanged,
    mass: flightChanged,
    ar: wingChanged,
  };
  for (const [key, onChange] of Object.entries(ranges)) {
    const input = $(key);
    const toState = key === 'mass' ? sliderToMass : Number;
    input.value = key === 'mass' ? massToSlider(state.mass) : state[key];
    input.addEventListener('input', () => {
      state[key] = toState(input.value);
      onChange();
    });
  }

  $('preset').addEventListener('change', () => {
    Object.assign(state, Aero.PRESETS[$('preset').value]);
    $('thickness').value = state.thickness;
    $('camber').value = state.camber;
    updateShape();
  });

  $('plane').addEventListener('change', () => {
    Object.assign(state, PLANES[$('plane').value]);
    $('mass').value = massToSlider(state.mass);
    $('area').value = state.area;
    $('ar').value = state.ar;
    wingChanged();
  });

  $('level').addEventListener('change', () => {
    setLevel($('level').checked);
    updateAlpha();
  });
  $('alarm').addEventListener('change', () => {
    state.alarm = $('alarm').checked;
    updateAlarm();
  });
  document.addEventListener('visibilitychange', updateAlarm);

  /** @type {HTMLInputElement[]} */ ($$('[data-show]')).forEach(box => {
    box.checked = state.show[box.dataset.show];
    box.addEventListener('change', () => {
      state.show[box.dataset.show] = box.checked;
      $('pressureKey').hidden = !state.show.pressure;
      scene?.setShow(state.show);
      scheduleUrlUpdate();
    });
  });
  $$('[data-mode]').forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
  // The legend holds the display toggles: clicking it must not tilt the wing or turn the camera.
  $('legend').addEventListener('pointerdown', e => e.stopPropagation());
  $('pressureKey').hidden = !state.show.pressure;

  $$('[data-lang]').forEach(btn =>
    btn.addEventListener('click', () => {
      state.lang = btn.dataset.lang;
      applyLanguage();
    }),
  );

  $('shareBtn').addEventListener('click', share);
  $('helpBtn').addEventListener('click', () => $('help').showModal());
  $('help').addEventListener('click', e => {
    if (e.target === $('help')) $('help').close();
  });
}

const FRAME_MS = 1000 / 30;
let last = performance.now();
let visible = true;
function frame(now) {
  if (now - last < FRAME_MS - 2) {
    requestAnimationFrame(frame);
    return;
  }
  const dt = Math.min(0.08, (now - last) / 1000);
  last = now;
  time += dt;
  if (scene && visible && stage.clientWidth && stage.clientHeight) scene.frame(dt, time, state.speed);
  requestAnimationFrame(frame);
}

let savedMode = DEFAULT_VIEW;
try {
  state.lang = localStorage.getItem('lang') || (navigator.language.startsWith('fr') ? 'fr' : 'en');
  if (localStorage.getItem('view') === '2d') savedMode = '2d';
} catch {
  /* default */
}
// A shared link wins over the defaults and the remembered view.
const shared = decodeSettings(location.search);
Object.assign(state, shared.settings);
if (shared.view) savedMode = shared.view;
state.mode = savedMode;

bindControls();
setLevel(state.level);
setMode(savedMode);
updateShape();
applyLanguage();
new ResizeObserver(() => scene?.resize()).observe(stage);
new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting;
}).observe(stage);
requestAnimationFrame(frame);
