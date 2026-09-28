// Potential flow around an airfoil with an optional plain flap, solved with a
// linear-strength vortex panel method, plus a simple empirical model for stall
// and drag. All flow velocities are normalised (freestream = 1).
//
// The shapes are Joukowski airfoils (thickness and camber), whose trailing edge
// can be bent down as a flap. The panel solution is sampled once per shape on
// velocity grids; any angle of attack is then a mix of the α = 0° and α = 90°
// solutions, so changing the angle costs nothing.

/** @typedef {{ x: number, y: number }} Point */
/**
 * Velocity grid in the wing frame. Per node, `vel` holds (u, v) for α = 0° then for α = 90°;
 * `tex` holds what the pressure shader needs: |V₀|², V₀·V₉₀, |V₉₀|² and 1 inside the wing.
 * Nodes inside the wing carry values extended from outside, so interpolation stays smooth at the surface.
 * @typedef {{ x0: number, y0: number, h: number, nx: number, ny: number, vel: Float32Array, tex: Float32Array }} Grid
 */
/**
 * Everything needed to evaluate the flow, small enough to send to workers and the GPU.
 * @typedef {object} FlowField
 * @property {Float32Array} outline x, y pairs of the closed outline, for inside tests
 * @property {[number, number, number, number]} box outline bounding box: x0, y0, x1, y1
 * @property {Grid} fine near the wing
 * @property {Grid} coarse further away
 * @property {[number, number]} circulation for α = 0° and α = 90°, clockwise positive
 * @property {Point} centre where the far field puts the equivalent point vortex
 */
/**
 * Airfoil in its own frame: chord along x, retracted trailing edge at x = 2.
 * @typedef {object} Airfoil
 * @property {number} thickness fraction of the chord
 * @property {number} flap flap deflection, degrees, trailing edge down
 * @property {Point[]} pts closed outline, counter-clockwise from the trailing edge, upper surface first
 * @property {Point[]} upper trailing edge to leading edge
 * @property {Point[]} lower leading edge to trailing edge
 * @property {Point} le leading edge
 * @property {Point} te trailing edge, lowered by the flap
 * @property {number} xTE retracted trailing edge abscissa: the chord line runs from le to (xTE, 0)
 * @property {number} chord reference (retracted) chord
 * @property {Point} ac aerodynamic centre, at a quarter chord
 * @property {Point} hinge flap hinge, at 75 % chord on the camber line
 * @property {number} alpha0 zero-lift angle of the inviscid flow, degrees
 * @property {number} alpha0Clean the same with the flap retracted
 * @property {number} clSlope inviscid lift: CL = clSlope · sin(α − alpha0)
 * @property {Float32Array} surfaceSpeed per outline point: tangential speed for α = 0° then α = 90°
 * @property {FlowField} field
 */
/**
 * @typedef {object} Coefficients
 * @property {number} CL lift coefficient
 * @property {number} CD drag coefficient
 * @property {number} CDi induced drag coefficient, part of CD
 * @property {number} alphaInduced induced angle αᵢ, degrees: the section works at α − αᵢ
 * @property {number} stall 0 before the stall, rising to 1 when fully separated
 * @property {number} stallVis how turbulent the wake looks, 0 to 1
 * @property {1 | -1} side sign of the effective angle of attack
 * @property {number} zeroLift zero-lift angle, degrees
 * @property {number} stallPos stall angle, degrees
 * @property {number} stallNeg negative stall angle, degrees
 */
/** @typedef {{ ca: number, sa: number }} Flow cos α and sin α */
/** @typedef {{ u: number, v: number, inside: boolean }} Velocity */
/** @typedef {{ x0: number, top: number, bot: number, spreadUp: number, spreadDown: number, len: number, k: number }} Wake */

const DEG = Math.PI / 180;
const VISCOUS_FACTOR = 0.85;
const OSWALD = 0.85;
const PANELS = 160;
const FLAP_CHORD = 0.25;
const MAX_FLAP = 40;

/** @type {Record<string, { thickness: number, camber: number }>} */
const PRESETS = {
  classic: { thickness: 11, camber: 5 },
  symmetric: { thickness: 12, camber: 0 },
  flat: { thickness: 1.5, camber: 0 },
  cambered: { thickness: 12, camber: 10 },
};

/**
 * Height of a surface polyline at abscissa x (0 outside it).
 * @param {Point[]} list
 * @param {number} x
 */
function surfaceY(list, x) {
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i],
      b = list[i + 1];
    if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) {
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
  }
  return 0;
}

// ---------- Shape ----------

/**
 * Joukowski outline: circle of centre (mx, my) through ζ = 1, mapped by z = ζ + 1/ζ.
 * Trailing edge at z = 2, chord close to 4, points bunched at both edges.
 * @param {number} thicknessPct
 * @param {number} camberPct
 */
function joukowskiOutline(thicknessPct, camberPct) {
  const eps = Math.max(0.004, thicknessPct / 100 / 1.299);
  const mx = -eps,
    my = (2 * camberPct) / 100;
  const R = Math.hypot(1 - mx, my);
  const beta = Math.atan2(my, 1 - mx);
  /** @type {Point[]} */
  const pts = [];
  for (let i = 0; i <= PANELS; i++) {
    const th = -beta + (2 * Math.PI * i) / PANELS;
    const zx = mx + R * Math.cos(th),
      zy = my + R * Math.sin(th);
    const m2 = zx * zx + zy * zy;
    pts.push({ x: zx + zx / m2, y: zy - zy / m2 });
  }
  // Both ends are the trailing edge: make them exactly equal.
  pts[PANELS] = { ...pts[0] };
  return pts;
}

/**
 * Airfoil shape, with the rear 25 % bent down around a hinge at 75 % chord.
 * The bend is spread over a short knee so the outline stays smooth.
 * @param {number} thicknessPct
 * @param {number} camberPct
 * @param {number} [flapDeg]
 */
function makeShape(thicknessPct, camberPct, flapDeg = 0) {
  const base = joukowskiOutline(thicknessPct, camberPct);
  let iLE = 0;
  base.forEach((p, i) => {
    if (p.x < base[iLE].x) iLE = i;
  });
  const le = base[iLE],
    xTE = 2,
    chord = xTE - le.x;
  const upper0 = base.slice(0, iLE + 1),
    lower0 = base.slice(iLE);
  const hx = le.x + (1 - FLAP_CHORD) * chord;
  const hinge = { x: hx, y: (surfaceY(upper0, hx) + surfaceY(lower0, hx)) / 2 };

  const delta = Math.min(MAX_FLAP, Math.max(0, flapDeg)) * DEG;
  const knee = 0.08 * chord;
  const pts = base.map(p => {
    const t = Math.min(1, Math.max(0, (p.x - hx + knee / 2) / knee));
    const phi = delta * t * t * (3 - 2 * t);
    if (!phi) return p;
    // Clockwise rotation about the hinge: the trailing edge goes down.
    const dx = p.x - hinge.x,
      dy = p.y - hinge.y,
      c = Math.cos(phi),
      s = Math.sin(phi);
    return { x: hinge.x + dx * c + dy * s, y: hinge.y - dx * s + dy * c };
  });

  const upper = pts.slice(0, iLE + 1);
  const lower = pts.slice(iLE);
  const xAC = le.x + chord / 4;
  return {
    thickness: thicknessPct / 100,
    flap: delta / DEG,
    pts,
    upper,
    lower,
    le: pts[iLE],
    te: pts[0],
    xTE,
    chord,
    ac: { x: xAC, y: (surfaceY(upper, xAC) + surfaceY(lower, xAC)) / 2 },
    hinge,
  };
}

// ---------- Vortex panel method (Kuethe & Chow) ----------

/**
 * Influence of the linear vortex panels on the velocity component along direction φ at (x, y),
 * for a unit strength at each panel node. Adds into `out` (length panels + 1).
 * @param {PanelSet} P
 * @param {number} x
 * @param {number} y
 * @param {number} cphi cos φ
 * @param {number} sphi sin φ
 * @param {Float64Array} out
 */
function tangentInfluence(P, x, y, cphi, sphi, out) {
  const { xb, yb, len, cos, sin } = P;
  for (let j = 0; j < P.n; j++) {
    const dx = x - xb[j],
      dy = y - yb[j],
      S = len[j];
    const A = -dx * cos[j] - dy * sin[j];
    const B = dx * dx + dy * dy;
    // sin/cos of (φ − θj) and (φ − 2θj)
    const C = sphi * cos[j] - cphi * sin[j];
    const D = cphi * cos[j] + sphi * sin[j];
    const c2 = cos[j] * cos[j] - sin[j] * sin[j],
      s2 = 2 * sin[j] * cos[j];
    const s2phi = sphi * c2 - cphi * s2,
      c2phi = cphi * c2 + sphi * s2;
    const E = dx * sin[j] - dy * cos[j];
    const F = Math.log(1 + (S * (S + 2 * A)) / B);
    const G = Math.atan2(E * S, B + A * S);
    const Pp = dx * s2phi + dy * c2phi;
    const CT2 = C + (0.5 * Pp * F) / S + ((A * D - C * E) * G) / S;
    const CT1 = 0.5 * C * F - D * G - CT2;
    out[j] += CT1;
    out[j + 1] += CT2;
  }
}

/**
 * @typedef {{ n: number, xb: Float64Array, yb: Float64Array, len: Float64Array, cos: Float64Array, sin: Float64Array }} PanelSet
 */

/**
 * Solves the panel strengths for α = 0° and α = 90°. Nodes run clockwise from the trailing edge.
 * @param {Point[]} pts counter-clockwise outline (as in Airfoil.pts)
 */
function solvePanels(pts) {
  const n = pts.length - 1;
  const xb = new Float64Array(n + 1),
    yb = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    xb[i] = pts[n - i].x;
    yb[i] = pts[n - i].y;
  }
  const len = new Float64Array(n),
    cos = new Float64Array(n),
    sin = new Float64Array(n),
    xc = new Float64Array(n),
    yc = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const dx = xb[j + 1] - xb[j],
      dy = yb[j + 1] - yb[j];
    len[j] = Math.hypot(dx, dy);
    cos[j] = dx / len[j];
    sin[j] = dy / len[j];
    xc[j] = (xb[j] + xb[j + 1]) / 2;
    yc[j] = (yb[j] + yb[j + 1]) / 2;
  }
  /** @type {PanelSet} */
  const P = { n, xb, yb, len, cos, sin };

  // Normal-velocity equations at each control point, plus the Kutta condition.
  const m = n + 1;
  const An = new Float64Array(m * m),
    At = new Float64Array(n * m);
  const rhs0 = new Float64Array(m),
    rhs90 = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const t = (() => {
        if (i === j) return { CN1: -1, CN2: 1, CT1: Math.PI / 2, CT2: Math.PI / 2 };
        const dx = xc[i] - xb[j],
          dy = yc[i] - yb[j],
          S = len[j];
        const A = -dx * cos[j] - dy * sin[j];
        const B = dx * dx + dy * dy;
        const C = sin[i] * cos[j] - cos[i] * sin[j];
        const D = cos[i] * cos[j] + sin[i] * sin[j];
        const E = dx * sin[j] - dy * cos[j];
        const F = Math.log(1 + (S * (S + 2 * A)) / B);
        const G = Math.atan2(E * S, B + A * S);
        const c2 = cos[j] * cos[j] - sin[j] * sin[j],
          s2 = 2 * sin[j] * cos[j];
        const s2i = sin[i] * c2 - cos[i] * s2,
          c2i = cos[i] * c2 + sin[i] * s2;
        const Pp = dx * s2i + dy * c2i;
        const Q = dx * c2i - dy * s2i;
        const CN2 = D + (0.5 * Q * F) / S - ((A * C + D * E) * G) / S;
        const CN1 = 0.5 * D * F + C * G - CN2;
        const CT2 = C + (0.5 * Pp * F) / S + ((A * D - C * E) * G) / S;
        const CT1 = 0.5 * C * F - D * G - CT2;
        return { CN1, CN2, CT1, CT2 };
      })();
      An[i * m + j] += t.CN1;
      An[i * m + j + 1] += t.CN2;
      At[i * m + j] += t.CT1;
      At[i * m + j + 1] += t.CT2;
    }
    rhs0[i] = sin[i];
    rhs90[i] = -cos[i];
  }
  An[n * m] = 1;
  An[n * m + n] = 1;

  const [g0, g90] = solveLinear(An, m, [rhs0, rhs90]);

  // Tangential speed at the control points, then circulation (clockwise positive).
  const v0 = new Float64Array(n),
    v90 = new Float64Array(n);
  let circ0 = 0,
    circ90 = 0;
  for (let i = 0; i < n; i++) {
    let s0 = cos[i],
      s90 = sin[i];
    for (let j = 0; j < m; j++) {
      s0 += At[i * m + j] * g0[j];
      s90 += At[i * m + j] * g90[j];
    }
    v0[i] = s0;
    v90[i] = s90;
    circ0 += Math.PI * (g0[i] + g0[i + 1]) * len[i];
    circ90 += Math.PI * (g90[i] + g90[i + 1]) * len[i];
  }
  return { P, g0, g90, v0, v90, circ: /** @type {[number, number]} */ ([circ0, circ90]) };
}

/**
 * Gaussian elimination with partial pivoting, several right-hand sides.
 * @param {Float64Array} M square matrix, row-major, destroyed
 * @param {number} m size
 * @param {Float64Array[]} rhs destroyed
 */
function solveLinear(M, m, rhs) {
  for (let k = 0; k < m; k++) {
    let p = k;
    for (let i = k + 1; i < m; i++) if (Math.abs(M[i * m + k]) > Math.abs(M[p * m + k])) p = i;
    if (p !== k) {
      for (let j = 0; j < m; j++) [M[k * m + j], M[p * m + j]] = [M[p * m + j], M[k * m + j]];
      for (const b of rhs) [b[k], b[p]] = [b[p], b[k]];
    }
    const pivot = M[k * m + k];
    for (let i = k + 1; i < m; i++) {
      const f = M[i * m + k] / pivot;
      if (!f) continue;
      for (let j = k; j < m; j++) M[i * m + j] -= f * M[k * m + j];
      for (const b of rhs) b[i] -= f * b[k];
    }
  }
  return rhs.map(b => {
    const x = new Float64Array(m);
    for (let i = m - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < m; j++) s -= M[i * m + j] * x[j];
      x[i] = s / M[i * m + i];
    }
    return x;
  });
}

// ---------- Velocity field ----------

const scratch = { u: new Float64Array(PANELS + 2), v: new Float64Array(PANELS + 2) };

/**
 * Exact panel velocity at a point of the wing frame, for α = 0° and α = 90°.
 * @param {ReturnType<typeof solvePanels>} sol
 * @param {number} x
 * @param {number} y
 * @returns {[number, number, number, number]} u₀, v₀, u₉₀, v₉₀
 */
function panelVelocity(sol, x, y) {
  const { P, g0, g90 } = sol;
  const u = scratch.u.fill(0),
    v = scratch.v.fill(0);
  tangentInfluence(P, x, y, 1, 0, u);
  tangentInfluence(P, x, y, 0, 1, v);
  let u0 = 1,
    v0 = 0,
    u90 = 0,
    v90 = 1;
  for (let j = 0; j <= P.n; j++) {
    u0 += u[j] * g0[j];
    v0 += v[j] * g0[j];
    u90 += u[j] * g90[j];
    v90 += v[j] * g90[j];
  }
  return [u0, v0, u90, v90];
}

/**
 * @param {Float32Array} outline
 * @param {number} x
 * @param {number} y
 */
function insideOutline(outline, x, y) {
  let inside = false;
  for (let i = 0, j = outline.length - 2; i < outline.length; j = i, i += 2) {
    const xi = outline[i],
      yi = outline[i + 1],
      xj = outline[j],
      yj = outline[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Samples the panel solution on a grid; inside nodes get values spread from their outside neighbours.
 * @param {ReturnType<typeof solvePanels>} sol
 * @param {Float32Array} outline
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} h node spacing
 * @param {Point} te trailing edge
 * @param {(x: number, y: number) => boolean} [skip] nodes covered by a finer grid
 * @returns {Grid}
 */
function sampleGrid(sol, outline, x0, y0, x1, y1, h, te, skip) {
  const nx = Math.round((x1 - x0) / h) + 1,
    ny = Math.round((y1 - y0) / h) + 1;
  const vel = new Float32Array(nx * ny * 4),
    tex = new Float32Array(nx * ny * 4);
  const known = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * h,
        y = y0 + j * h,
        k = j * nx + i;
      if (insideOutline(outline, x, y)) {
        tex[k * 4 + 3] = 1;
        continue;
      }
      // Right at the sharp trailing edge the panel sums are near-singular: fill from the neighbours instead.
      if (Math.hypot(x - te.x, y - te.y) < 1.6 * h) continue;
      known[k] = 1;
      if (skip && skip(x, y)) continue;
      vel.set(panelVelocity(sol, x, y), k * 4);
    }
  }
  // Grow the outside values into the wing, a ring of nodes at a time.
  for (let pass = 0; pass < 200; pass++) {
    const next = known.slice();
    let missing = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (known[k]) continue;
        let count = 0;
        const sum = [0, 0, 0, 0];
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const a = i + di,
            b = j + dj;
          if (a < 0 || b < 0 || a >= nx || b >= ny || !known[b * nx + a]) continue;
          for (let c = 0; c < 4; c++) sum[c] += vel[(b * nx + a) * 4 + c];
          count++;
        }
        if (!count) {
          missing++;
          continue;
        }
        for (let c = 0; c < 4; c++) vel[k * 4 + c] = sum[c] / count;
        next[k] = 1;
      }
    }
    known.set(next);
    if (!missing) break;
  }
  for (let k = 0; k < nx * ny; k++) {
    const u0 = vel[k * 4],
      v0 = vel[k * 4 + 1],
      u90 = vel[k * 4 + 2],
      v90 = vel[k * 4 + 3];
    tex[k * 4] = u0 * u0 + v0 * v0;
    tex[k * 4 + 1] = u0 * u90 + v0 * v90;
    tex[k * 4 + 2] = u90 * u90 + v90 * v90;
  }
  return { x0, y0, h, nx, ny, vel, tex };
}

// Grid extents in the wing frame. The coarse one covers every view at any angle.
const FINE = { x0: -2.8, y0: -1.6, x1: 2.8, y1: 1.6, h: 0.05 };
const COARSE = { x0: -16, y0: -14, x1: 16, y1: 14, h: 0.25 };

/**
 * Shape, panel solution and velocity grids for one airfoil. Takes a few hundred milliseconds:
 * the page runs it in a worker.
 * @param {number} thicknessPct
 * @param {number} camberPct
 * @param {number} [flapDeg]
 * @returns {Airfoil}
 */
function makeAirfoil(thicknessPct, camberPct, flapDeg = 0) {
  const shape = makeShape(thicknessPct, camberPct, flapDeg);
  const sol = solvePanels(shape.pts);
  const n = shape.pts.length - 1;

  const outline = new Float32Array(n * 2);
  let bx0 = Infinity,
    by0 = Infinity,
    bx1 = -Infinity,
    by1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = shape.pts[i];
    outline[i * 2] = p.x;
    outline[i * 2 + 1] = p.y;
    bx0 = Math.min(bx0, p.x);
    by0 = Math.min(by0, p.y);
    bx1 = Math.max(bx1, p.x);
    by1 = Math.max(by1, p.y);
  }
  const fine = sampleGrid(sol, outline, FINE.x0, FINE.y0, FINE.x1, FINE.y1, FINE.h, shape.te);
  // Coarse nodes well inside the fine grid are never read: coarse cells are only used outside it.
  const m = COARSE.h * 1.01;
  const inFine = (/** @type {number} */ x, /** @type {number} */ y) =>
    x > FINE.x0 + m && x < FINE.x1 - m && y > FINE.y0 + m && y < FINE.y1 - m;
  const coarse = sampleGrid(sol, outline, COARSE.x0, COARSE.y0, COARSE.x1, COARSE.y1, COARSE.h, shape.te, inFine);

  // Surface speed per outline point: average of the two panels around it (solver order is reversed).
  const surfaceSpeed = new Float32Array((n + 1) * 2);
  for (let k = 0; k <= n; k++) {
    // Outline point k is solver node n − k, between solver panels n − k − 1 and n − k.
    const a = Math.max(0, n - k - 1),
      b = Math.min(n - 1, n - k);
    surfaceSpeed[k * 2] = (sol.v0[a] + sol.v0[b]) / 2;
    surfaceSpeed[k * 2 + 1] = (sol.v90[a] + sol.v90[b]) / 2;
  }

  // CL = 2Γ / c, with Γ(α) = Γ₀ cos α + Γ₉₀ sin α = K sin(α − α₀).
  const [c0, c90] = sol.circ;
  const K = Math.hypot(c0, c90);
  const alpha0 = Math.atan2(-c0, c90) / DEG;
  let alpha0Clean = alpha0;
  if (shape.flap) {
    const [k0, k90] = solvePanels(makeShape(thicknessPct, camberPct).pts).circ;
    alpha0Clean = Math.atan2(-k0, k90) / DEG;
  }
  return {
    ...shape,
    alpha0,
    alpha0Clean,
    clSlope: (2 * K) / shape.chord,
    surfaceSpeed,
    field: {
      outline,
      box: [bx0, by0, bx1, by1],
      fine,
      coarse,
      circulation: sol.circ,
      centre: shape.ac,
    },
  };
}

/**
 * @param {Grid} g
 * @param {number} x
 * @param {number} y
 * @param {number} ca
 * @param {number} sa
 * @param {Velocity} out
 */
function sampleVelocity(g, x, y, ca, sa, out) {
  const fx = (x - g.x0) / g.h,
    fy = (y - g.y0) / g.h;
  const i = Math.min(g.nx - 2, Math.max(0, Math.floor(fx))),
    j = Math.min(g.ny - 2, Math.max(0, Math.floor(fy)));
  const tx = fx - i,
    ty = fy - j;
  const k00 = (j * g.nx + i) * 4,
    k10 = k00 + 4,
    k01 = k00 + g.nx * 4,
    k11 = k01 + 4;
  const w00 = (1 - tx) * (1 - ty),
    w10 = tx * (1 - ty),
    w01 = (1 - tx) * ty,
    w11 = tx * ty;
  const d = g.vel;
  const at = (/** @type {number} */ c) => w00 * d[k00 + c] + w10 * d[k10 + c] + w01 * d[k01 + c] + w11 * d[k11 + c];
  out.u = ca * at(0) + sa * at(2);
  out.v = ca * at(1) + sa * at(3);
}

/**
 * World frame: wind blows along +x, the wing is pitched nose-up by α.
 * @param {FlowField} field
 * @param {Flow} flow
 * @param {number} x
 * @param {number} y
 * @param {Velocity} out
 */
function velocityWorld(field, flow, x, y, out) {
  const { ca, sa } = flow;
  const zx = x * ca - y * sa,
    zy = x * sa + y * ca;
  const [bx0, by0, bx1, by1] = field.box;
  if (zx > bx0 && zx < bx1 && zy > by0 && zy < by1 && insideOutline(field.outline, zx, zy)) {
    out.inside = true;
    return;
  }
  out.inside = false;
  const { fine, coarse } = field;
  const inGrid = (/** @type {Grid} */ g) =>
    zx >= g.x0 && zy >= g.y0 && zx <= g.x0 + (g.nx - 1) * g.h && zy <= g.y0 + (g.ny - 1) * g.h;
  if (inGrid(fine)) sampleVelocity(fine, zx, zy, ca, sa, out);
  else if (inGrid(coarse)) sampleVelocity(coarse, zx, zy, ca, sa, out);
  else {
    // Far away: freestream plus a point vortex carrying the circulation (clockwise).
    const gamma = field.circulation[0] * ca + field.circulation[1] * sa;
    const dx = zx - field.centre.x,
      dy = zy - field.centre.y,
      r2 = dx * dx + dy * dy;
    out.u = ca + (gamma * dy) / (2 * Math.PI * r2);
    out.v = sa - (gamma * dx) / (2 * Math.PI * r2);
  }
  const U = out.u,
    V = out.v;
  out.u = U * ca + V * sa;
  out.v = -U * sa + V * ca;
}

/**
 * Same as velocityWorld, capped near the sharp trailing edge. False inside the wing.
 * @param {FlowField} field
 * @param {Flow} flow
 * @param {number} x
 * @param {number} y
 * @param {Velocity} out
 */
function velocityClamped(field, flow, x, y, out) {
  velocityWorld(field, flow, x, y, out);
  if (out.inside) return false;
  const sp = Math.hypot(out.u, out.v);
  if (sp > 3) {
    out.u *= 3 / sp;
    out.v *= 3 / sp;
  }
  return true;
}

/**
 * Pressure coefficient along the outline, from the panel solution.
 * @param {Airfoil} af
 * @param {Flow} flow
 * @returns {Float32Array} one value per outline point
 */
function surfacePressure(af, flow) {
  const n = af.pts.length;
  const cp = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const v = flow.ca * af.surfaceSpeed[k * 2] + flow.sa * af.surfaceSpeed[k * 2 + 1];
    cp[k] = 1 - v * v;
  }
  return cp;
}

// ---------- Coefficients ----------

/**
 * Airfoil section (infinite wing): lift from the panel solution, then an empirical stall; profile drag.
 * @param {Airfoil} af
 * @param {number} alphaDeg
 */
function sectionCoefficients(af, alphaDeg) {
  // Past 15°, the air starts to separate from a real flap: scale its effect down, to 60 % at 40°.
  const flapEfficiency = 1 - 0.4 * Math.min(1, Math.max(0, (af.flap - 15) / 25));
  const zeroLift = af.alpha0Clean + flapEfficiency * (af.alpha0 - af.alpha0Clean);
  // Angle of the zero-lift line below the chord; for a Joukowski airfoil this is its camber angle β.
  const camberDeg = -zeroLift;
  const stallAngle = Math.min(17, 9 + 50 * af.thickness);
  const stallPosEff = stallAngle + 0.8 * camberDeg;
  const stallNegEff = stallAngle - 0.2 * camberDeg;
  /** @param {number} ae */
  const linear = ae => VISCOUS_FACTOR * af.clSlope * Math.sin(ae * DEG);

  const ae = alphaDeg + camberDeg;
  const side = ae >= 0 ? 1 : -1;
  const limit = side > 0 ? stallPosEff : stallNegEff;
  const over = Math.abs(ae) - limit;

  let CL = linear(ae),
    stall = 0;
  if (over > 0) {
    stall = Math.min(1, over / 6);
    const clMax = Math.abs(linear(limit));
    const flatPlate = 0.95 * Math.abs(Math.sin(2 * ae * DEG));
    CL = side * ((1 - stall) * clMax * (1 - 0.25 * stall) + stall * flatPlate);
  }

  // Profile drag, plus the extra drag of a deflected flap and of separated flow.
  const cd0 = 0.007 + 0.03 * af.thickness + 0.12 * Math.sin(af.flap * DEG) ** 2;
  const separated = stall * 1.6 * Math.sin(ae * DEG) ** 2;

  return {
    CL,
    CDp: cd0 + separated,
    stall,
    stallVis: over > 0 ? Math.min(1, 0.3 + over / 8) : 0,
    /** @type {1 | -1} */ side: /** @type {1 | -1} */ (side),
    zeroLift,
    stallPos: stallPosEff - camberDeg,
    stallNeg: -stallNegEff - camberDeg,
  };
}

/**
 * Whole wing of aspect ratio `ar`, with Prandtl's lifting-line theory: the trailing vortices push the air
 * down (downwash), so every section works at a lower effective angle α − αᵢ, with αᵢ = CL / (π e A),
 * and the lift leans back, giving the induced drag CL² / (π e A). An infinite aspect ratio gives the section.
 * @param {Airfoil} af
 * @param {number} alphaDeg geometric angle of attack
 * @param {number} [ar] aspect ratio, span² / area
 * @returns {Coefficients}
 */
function coefficients(af, alphaDeg, ar = Infinity) {
  // Induced angle per unit of lift coefficient, in degrees.
  const k = Number.isFinite(ar) ? 1 / (Math.PI * OSWALD * ar) / DEG : 0;
  // CL = CL_section(α − k·CL): the left side minus the right side grows with CL, so bisection finds it.
  let lo = -4,
    hi = 5;
  for (let i = 0; i < (k ? 50 : 0); i++) {
    const mid = (lo + hi) / 2;
    if (mid - sectionCoefficients(af, alphaDeg - k * mid).CL > 0) hi = mid;
    else lo = mid;
  }
  const CLwing = k ? (lo + hi) / 2 : 0;
  const alphaInduced = k * CLwing;
  const sec = sectionCoefficients(af, alphaDeg - alphaInduced);
  const CL = k ? CLwing : sec.CL;
  const CDi = k ? (CL * CL) / (Math.PI * OSWALD * ar) : 0;
  // The section stalls at a fixed effective angle; the wing gets there at a higher geometric angle.
  const atStall = (/** @type {number} */ a) => a + k * sectionCoefficients(af, a).CL;

  return {
    CL,
    CD: sec.CDp + CDi,
    CDi,
    alphaInduced,
    stall: sec.stall,
    stallVis: sec.stallVis,
    side: sec.side,
    zeroLift: sec.zeroLift,
    stallPos: atStall(sec.stallPos),
    stallNeg: atStall(sec.stallNeg),
  };
}

/**
 * @param {number} alphaDeg
 * @returns {Flow}
 */
function flowFor(alphaDeg) {
  const a = alphaDeg * DEG;
  return { ca: Math.cos(a), sa: Math.sin(a) };
}

// ---------- Tip vortices (3D view) ----------

/**
 * Two trailing vortices leaving the wing tips at the quarter chord and running downstream (+x),
 * in the 3D world frame (z spanwise). `gamma` is the root circulation, positive for positive lift.
 * @typedef {{ x0: number, y0: number, zTip: number, gamma: number, core: number }} TipVortices
 */

/**
 * Root circulation of an elliptically loaded wing: lift = ρ V Γ₀ π b / 4, so with V = 1 and a
 * rectangular planform (area = b c), Γ₀ = 2 c CL / π.
 * @param {number} chord
 * @param {number} CL wing lift coefficient
 */
function rootCirculation(chord, CL) {
  return (2 * chord * CL) / Math.PI;
}

/**
 * Velocity induced by the tip vortices (Biot–Savart, semi-infinite lines, with a soft core so it
 * stays finite on the axis). Inboard they push the air down, outboard they lift it.
 * @param {TipVortices} tv
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {[number, number, number]}
 */
function tipVortexVelocity(tv, x, y, z) {
  let v = 0,
    w = 0;
  for (const [zt, g] of [
    [-tv.zTip, tv.gamma],
    [tv.zTip, -tv.gamma],
  ]) {
    const rx = x - tv.x0,
      ry = y - tv.y0,
      rz = z - zt;
    const h2 = ry * ry + rz * rz;
    const r = Math.sqrt(rx * rx + h2);
    // Semi-infinite line from the wing to far downstream: (1 + cos θ) of the infinite line's 2.
    const k = ((g / (4 * Math.PI)) * (1 + rx / (r || 1))) / (h2 + tv.core * tv.core);
    // Direction (1, 0, 0) × (0, ry, rz) = (0, −rz, ry).
    v -= k * rz;
    w += k * ry;
  }
  return [0, v, w];
}

// ---------- Stall wake (visual only) ----------

/**
 * Region behind the separation point where particles get turbulent.
 * @param {Airfoil} af
 * @param {Flow} flow
 * @param {Coefficients} co
 * @returns {Wake | null}
 */
function stallWake(af, flow, co) {
  if (!co.stallVis) return null;
  /** @param {Point} p */
  const toWorld = p => ({ x: p.x * flow.ca + p.y * flow.sa, y: -p.x * flow.sa + p.y * flow.ca });
  const xs = af.te.x - (0.2 + 0.55 * co.stallVis) * af.chord;
  const S = toWorld({ x: xs, y: surfaceY(co.side > 0 ? af.upper : af.lower, xs) });
  const T = toWorld(af.te);
  return {
    x0: S.x,
    top: Math.max(S.y, T.y) + 0.1,
    bot: Math.min(S.y, T.y) - 0.1,
    spreadUp: co.side > 0 ? 0.22 : 0.08,
    spreadDown: co.side > 0 ? 0.08 : 0.22,
    len: 2.5 + 6 * co.stallVis,
    k: co.stallVis,
  };
}

/**
 * @param {Wake | null} wake
 * @param {number} x
 * @param {number} y
 */
function wakeIntensity(wake, x, y) {
  if (!wake) return 0;
  const d = x - wake.x0;
  if (d < 0 || d > wake.len) return 0;
  const edge = Math.min(wake.top + wake.spreadUp * d - y, y - wake.bot + wake.spreadDown * d);
  if (edge <= 0) return 0;
  return Math.min(0.9, 1.2 * wake.k * (1 - d / wake.len)) * Math.min(1, edge / 0.4);
}

/**
 * International standard atmosphere, troposphere.
 * @param {number} altitude metres
 */
function airDensity(altitude) {
  return 1.225 * Math.pow(1 - 2.25577e-5 * altitude, 4.2559);
}

export {
  PRESETS,
  MAX_FLAP,
  makeShape,
  makeAirfoil,
  solvePanels,
  panelVelocity,
  coefficients,
  sectionCoefficients,
  flowFor,
  rootCirculation,
  tipVortexVelocity,
  velocityWorld,
  velocityClamped,
  surfacePressure,
  stallWake,
  wakeIntensity,
  airDensity,
  surfaceY,
};
