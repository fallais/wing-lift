import { describe, expect, it } from 'vitest';
import * as Aero from './aero.js';

const classic = Aero.makeAirfoil(11, 5);
const symmetric = Aero.makeAirfoil(12, 0);
const flapped = Aero.makeAirfoil(11, 5, 20);

/** Wing-frame point to world frame, as the views do. */
const toWorld = (flow, p) => ({ x: p.x * flow.ca + p.y * flow.sa, y: -p.x * flow.sa + p.y * flow.ca });

function velocity(af, flow, x, y) {
  const out = { u: 0, v: 0, inside: false };
  Aero.velocityWorld(af.field, flow, x, y, out);
  return out;
}

/**
 * Exact potential flow around the same Joukowski airfoil (conformal mapping), world frame.
 * The panel method must reproduce it when the flap is retracted.
 */
function joukowski(thicknessPct, camberPct, alphaDeg, x, y) {
  const eps = Math.max(0.004, thicknessPct / 100 / 1.299);
  const mx = -eps,
    my = (2 * camberPct) / 100;
  const R = Math.hypot(1 - mx, my),
    R2 = R * R,
    beta = Math.atan2(my, 1 - mx);
  const a = (alphaDeg * Math.PI) / 180,
    ca = Math.cos(a),
    sa = Math.sin(a),
    G = 2 * R * Math.sin(a + beta);
  const zx = x * ca - y * sa,
    zy = x * sa + y * ca;
  const ax = zx * zx - zy * zy - 4,
    ay = 2 * zx * zy,
    r = Math.hypot(ax, ay);
  const sx = Math.sqrt(Math.max(0, (r + ax) / 2)),
    sy = Math.sqrt(Math.max(0, (r - ax) / 2)) * (ay < 0 ? -1 : 1);
  let px = (zx + sx) / 2,
    py = (zy + sy) / 2,
    dx = px - mx,
    dy = py - my,
    dd = dx * dx + dy * dy;
  const qx = (zx - sx) / 2,
    qy = (zy - sy) / 2,
    ex = qx - mx,
    ey = qy - my;
  if (ex * ex + ey * ey > dd) {
    px = qx;
    py = qy;
    dx = ex;
    dy = ey;
    dd = ex * ex + ey * ey;
  }
  const d2x = dx * dx - dy * dy,
    d2y = 2 * dx * dy,
    d4 = d2x * d2x + d2y * d2y;
  const wx = ca - (R2 * (ca * d2x + sa * d2y)) / d4 + (G * dy) / dd;
  const wy = -sa - (R2 * (sa * d2x - ca * d2y)) / d4 + (G * dx) / dd;
  const p2x = px * px - py * py,
    p2y = 2 * px * py,
    p4 = p2x * p2x + p2y * p2y;
  const jx = 1 - p2x / p4,
    jy = p2y / p4,
    j2 = jx * jx + jy * jy;
  const u = (wx * jx + wy * jy) / j2,
    v = -(wy * jx - wx * jy) / j2;
  return { u: u * ca + v * sa, v: -u * sa + v * ca, beta: (beta * 180) / Math.PI, R };
}

describe('makeShape', () => {
  it('puts the trailing edge at x = 2 with a chord close to 4', () => {
    expect(classic.te.x).toBeCloseTo(2, 6);
    expect(classic.te.y).toBeCloseTo(0, 6);
    expect(classic.chord).toBeGreaterThan(3.9);
    expect(classic.chord).toBeLessThan(4.3);
  });

  it('has roughly the requested thickness', () => {
    const t = Math.max(...classic.pts.map(p => Aero.surfaceY(classic.upper, p.x) - Aero.surfaceY(classic.lower, p.x)));
    expect(t / classic.chord).toBeCloseTo(0.11, 1);
  });

  it('places the aerodynamic centre at a quarter chord', () => {
    expect((classic.ac.x - classic.le.x) / classic.chord).toBeCloseTo(0.25, 5);
  });

  it('lowers the trailing edge with the flap and leaves the front untouched', () => {
    // The trailing edge turns 20° clockwise about the hinge.
    const d = (20 * Math.PI) / 180,
      dx = classic.te.x - classic.hinge.x,
      dy = classic.te.y - classic.hinge.y;
    expect(flapped.te.x).toBeCloseTo(classic.hinge.x + dx * Math.cos(d) + dy * Math.sin(d), 6);
    expect(flapped.te.y).toBeCloseTo(classic.hinge.y - dx * Math.sin(d) + dy * Math.cos(d), 6);
    expect(flapped.te.y).toBeLessThan(-0.3);
    expect(flapped.le).toEqual(classic.le);
    expect(flapped.flap).toBe(20);
  });
});

describe('panel method', () => {
  it('reproduces the exact Joukowski flow around the airfoil', () => {
    const flow = Aero.flowFor(5);
    const points = [
      [-3, 0.5],
      [0, 0.6],
      [0, -0.4],
      [1, 0.5],
      [2.5, 0],
      [-2.3, 0],
      [0.5, 0.35],
      [1.5, 0.15],
      [-1.5, 0.45],
      [5, 3],
      [-8, -4],
    ];
    for (const [x, y] of points) {
      const exact = joukowski(11, 5, 5, x, y);
      const v = velocity(classic, flow, x, y);
      expect(v.inside).toBe(false);
      expect(Math.hypot(v.u - exact.u, v.v - exact.v) / Math.hypot(exact.u, exact.v)).toBeLessThan(0.02);
    }
  });

  it('finds the zero-lift angle and lift slope of the exact solution', () => {
    const exact = joukowski(11, 5, 0, 10, 10);
    // The sharp trailing edge costs the panel method a few tenths of a degree.
    expect(Math.abs(classic.alpha0 + exact.beta)).toBeLessThan(0.4);
    expect(classic.clSlope / ((8 * Math.PI * exact.R) / classic.chord)).toBeCloseTo(1, 1);
    expect(symmetric.alpha0).toBeCloseTo(0, 6);
  });

  it('flows along the surface, not through it', () => {
    const sol = Aero.solvePanels(classic.pts);
    const a = (5 * Math.PI) / 180;
    for (const i of [30, 60, 100, 130]) {
      const p = classic.pts[i],
        prev = classic.pts[i - 1],
        next = classic.pts[i + 1];
      const tx = next.x - prev.x,
        ty = next.y - prev.y,
        tl = Math.hypot(tx, ty);
      // Outward normal of a counter-clockwise outline.
      const nx = ty / tl,
        ny = -tx / tl;
      const [u0, v0, u90, v90] = Aero.panelVelocity(sol, p.x + nx * 0.01, p.y + ny * 0.01);
      const u = Math.cos(a) * u0 + Math.sin(a) * u90,
        v = Math.cos(a) * v0 + Math.sin(a) * v90;
      expect(Math.abs(u * nx + v * ny)).toBeLessThan(0.05 * Math.hypot(u, v));
    }
  });

  it('leaves the trailing edge smoothly (Kutta condition)', () => {
    const sol = Aero.solvePanels(classic.pts);
    const [u0, v0, u90, v90] = Aero.panelVelocity(sol, classic.te.x + 0.01, classic.te.y);
    const a = (5 * Math.PI) / 180;
    expect(Math.hypot(Math.cos(a) * u0 + Math.sin(a) * u90, Math.cos(a) * v0 + Math.sin(a) * v90)).toBeLessThan(1.5);
  });

  it('has a stagnation point at the nose and suction on the upper surface', () => {
    const cp = Aero.surfacePressure(classic, Aero.flowFor(5));
    expect(Math.max(...cp)).toBeGreaterThan(0.95);
    const iLE = classic.pts.indexOf(classic.le);
    const upper = cp.slice(5, iLE - 5),
      lower = cp.slice(iLE + 5, cp.length - 5);
    expect(Math.min(...upper)).toBeLessThan(Math.min(...lower));
  });

  it('joins the grids and the far field without a jump', () => {
    const flow = Aero.flowFor(5);
    // Either side of the fine grid edge (x = 2.8, y = 1.6 in the wing frame).
    for (const [p, q] of [
      [
        { x: 2.79, y: 0.3 },
        { x: 2.81, y: 0.3 },
      ],
      [
        { x: 0.5, y: 1.59 },
        { x: 0.5, y: 1.61 },
      ],
    ]) {
      const a = toWorld(flow, p),
        b = toWorld(flow, q);
      const va = velocity(classic, flow, a.x, a.y),
        vb = velocity(classic, flow, b.x, b.y);
      expect(Math.hypot(va.u - vb.u, va.v - vb.v)).toBeLessThan(0.02);
    }
    // Either side of the coarse grid edge (x = 16 in the wing frame).
    const a = toWorld(flow, { x: 15.9, y: 0 }),
      b = toWorld(flow, { x: 16.1, y: 0 });
    const near = velocity(classic, flow, a.x, a.y),
      far = velocity(classic, flow, b.x, b.y);
    expect(Math.hypot(near.u - far.u, near.v - far.v)).toBeLessThan(0.01);
    const veryFar = velocity(classic, flow, -300, 120);
    expect(veryFar.u).toBeCloseTo(1, 2);
    expect(veryFar.v).toBeCloseTo(0, 2);
  });

  it('flags points inside the wing, flap included', () => {
    const flow = Aero.flowFor(5);
    const inside = (af, x) => {
      const p = toWorld(flow, { x, y: (Aero.surfaceY(af.upper, x) + Aero.surfaceY(af.lower, x)) / 2 });
      return velocity(af, flow, p.x, p.y).inside;
    };
    expect(inside(classic, 0)).toBe(true);
    expect(inside(flapped, (flapped.hinge.x + flapped.te.x) / 2)).toBe(true);
  });
});

describe('coefficients', () => {
  it('gives no lift at the zero-lift angle', () => {
    const { zeroLift } = Aero.coefficients(classic, 0);
    expect(Aero.coefficients(classic, zeroLift).CL).toBeCloseTo(0, 6);
  });

  it('gives a symmetric airfoil no lift at 0° and an odd lift curve', () => {
    expect(Aero.coefficients(symmetric, 0).CL).toBeCloseTo(0, 6);
    expect(Aero.coefficients(symmetric, -6).CL).toBeCloseTo(-Aero.coefficients(symmetric, 6).CL, 6);
  });

  it('has a lift slope close to 0.1 per degree before the stall', () => {
    const slope = (Aero.coefficients(classic, 6).CL - Aero.coefficients(classic, 2).CL) / 4;
    expect(slope).toBeGreaterThan(0.08);
    expect(slope).toBeLessThan(0.11);
  });

  it('loses lift and gains drag past the stall angle', () => {
    const { stallPos } = Aero.coefficients(classic, 0);
    const atStall = Aero.coefficients(classic, stallPos);
    const beyond = Aero.coefficients(classic, stallPos + 5);
    expect(atStall.stall).toBe(0);
    expect(beyond.stall).toBeGreaterThan(0);
    expect(beyond.CL).toBeLessThan(atStall.CL);
    expect(beyond.CD).toBeGreaterThan(atStall.CD);
  });

  it('stalls later with a thicker airfoil', () => {
    const thin = Aero.coefficients(Aero.makeAirfoil(6, 0), 0).stallPos;
    const thick = Aero.coefficients(Aero.makeAirfoil(14, 0), 0).stallPos;
    expect(thick).toBeGreaterThan(thin);
  });
});

describe('flaps', () => {
  const clean = Aero.coefficients(classic, 0);
  const down = Aero.coefficients(flapped, 0);
  const clMax = (af, co) => Aero.coefficients(af, co.stallPos).CL;

  it('give more lift at the same angle', () => {
    expect(down.CL).toBeGreaterThan(clean.CL + 0.5);
    expect(down.zeroLift).toBeLessThan(clean.zeroLift - 8);
  });

  it('raise the maximum lift but stall at a slightly lower angle', () => {
    expect(clMax(flapped, down)).toBeGreaterThan(clMax(classic, clean) + 0.5);
    expect(down.stallPos).toBeLessThan(clean.stallPos);
    expect(down.stallPos).toBeGreaterThan(clean.stallPos - 5);
  });

  it('add drag', () => {
    expect(Aero.coefficients(flapped, down.zeroLift).CD).toBeGreaterThan(Aero.coefficients(classic, clean.zeroLift).CD);
  });
});

describe('finite wing (lifting line)', () => {
  const slope = ar => (Aero.coefficients(classic, 6, ar).CL - Aero.coefficients(classic, 2, ar).CL) / 4;

  it('lifts less per degree with a shorter wing, and tends to the section for long ones', () => {
    expect(slope(6)).toBeLessThan(slope(12));
    expect(slope(12)).toBeLessThan(slope(Infinity));
    expect(slope(1000) / slope(Infinity)).toBeCloseTo(1, 2);
    // Classic result for an elliptic wing: a = a₀ / (1 + a₀ / (π e A)), a₀ per radian.
    const a0 = slope(Infinity) * (180 / Math.PI);
    expect(slope(8) * (180 / Math.PI)).toBeCloseTo(a0 / (1 + a0 / (Math.PI * 0.85 * 8)), 1);
  });

  it('keeps the zero-lift angle, and works the section at α − αᵢ', () => {
    const w = Aero.coefficients(classic, 6, 8);
    expect(Aero.coefficients(classic, w.zeroLift, 8).CL).toBeCloseTo(0, 6);
    expect(w.alphaInduced).toBeCloseTo((w.CL / (Math.PI * 0.85 * 8)) * (180 / Math.PI), 6);
    expect(Aero.sectionCoefficients(classic, 6 - w.alphaInduced).CL).toBeCloseTo(w.CL, 4);
  });

  it('has induced drag CL² / (π e A), less for a longer wing', () => {
    const w = Aero.coefficients(classic, 6, 8);
    expect(w.CDi).toBeCloseTo((w.CL * w.CL) / (Math.PI * 0.85 * 8), 8);
    expect(Aero.coefficients(classic, 6, 25).CDi).toBeLessThan(w.CDi);
  });

  it('stalls at a higher geometric angle but with the same maximum lift', () => {
    const section = Aero.coefficients(classic, 0),
      wing = Aero.coefficients(classic, 0, 8);
    expect(wing.stallPos).toBeGreaterThan(section.stallPos + 2);
    expect(Aero.coefficients(classic, wing.stallPos, 8).CL).toBeCloseTo(
      Aero.coefficients(classic, section.stallPos).CL,
      3,
    );
    expect(Aero.coefficients(classic, wing.stallPos - 0.5, 8).stall).toBe(0);
    expect(Aero.coefficients(classic, wing.stallPos + 2, 8).stall).toBeGreaterThan(0);
  });
});

describe('tip vortices', () => {
  const tv = { x0: 0, y0: 0, zTip: 10, gamma: 2, core: 0.4 };

  it('push the air down between the tips and up outside them', () => {
    expect(Aero.tipVortexVelocity(tv, 5, 0, 0)[1]).toBeLessThan(0);
    expect(Aero.tipVortexVelocity(tv, 5, 0, 13)[1]).toBeGreaterThan(0);
    expect(Aero.tipVortexVelocity(tv, 5, 0, -13)[1]).toBeGreaterThan(0);
  });

  it('swirl around each tip and vanish far upstream', () => {
    // The air escapes round the tip from the high-pressure side: outwards below it, inwards above it.
    expect(Aero.tipVortexVelocity(tv, 5, -1, 10)[2]).toBeGreaterThan(0);
    expect(Aero.tipVortexVelocity(tv, 5, 1, 10)[2]).toBeLessThan(0);
    const upstream = Aero.tipVortexVelocity(tv, -200, 0, 0);
    expect(Math.hypot(...upstream)).toBeLessThan(1e-4);
  });

  it('match the downwash of an infinite vortex pair far downstream', () => {
    const [, v] = Aero.tipVortexVelocity(tv, 1e6, 0, 0);
    // Two infinite vortices at ±zTip: 2 × Γ / (2π zTip), minus a little for the core.
    expect(v).toBeCloseTo(-(2 * tv.gamma) / (2 * Math.PI * tv.zTip), 3);
  });

  it('carry the root circulation of an elliptic wing', () => {
    expect(Aero.rootCirculation(4, 1)).toBeCloseTo(8 / Math.PI, 10);
  });
});

describe('velocityClamped', () => {
  it('caps the speed at 3 and reports points inside the wing', () => {
    const flow = Aero.flowFor(5);
    const out = { u: 0, v: 0, inside: false };
    for (let x = -3; x < 3; x += 0.05) {
      if (Aero.velocityClamped(classic.field, flow, x, 0.5, out)) {
        expect(Math.hypot(out.u, out.v)).toBeLessThanOrEqual(3 + 1e-6);
      }
    }
    const mid = toWorld(flow, { x: 0, y: 0.2 });
    expect(Aero.velocityClamped(classic.field, flow, mid.x, mid.y, out)).toBe(false);
  });
});

describe('stall wake', () => {
  it('only exists once stalled, and is strongest just behind the wing', () => {
    expect(Aero.stallWake(classic, Aero.flowFor(5), Aero.coefficients(classic, 5))).toBeNull();
    const flow = Aero.flowFor(20);
    const wake = Aero.stallWake(classic, flow, Aero.coefficients(classic, 20));
    expect(wake).not.toBeNull();
    const y = (wake.top + wake.bot) / 2;
    expect(Aero.wakeIntensity(wake, wake.x0 + 0.5, y)).toBeGreaterThan(Aero.wakeIntensity(wake, wake.x0 + 5, y));
    expect(Aero.wakeIntensity(wake, wake.x0 - 1, y)).toBe(0);
  });
});

describe('airDensity', () => {
  it('matches the standard atmosphere', () => {
    expect(Aero.airDensity(0)).toBeCloseTo(1.225, 3);
    expect(Aero.airDensity(10000)).toBeCloseTo(0.4135, 2);
  });
});
