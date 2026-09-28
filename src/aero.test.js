import { describe, expect, it } from 'vitest';
import * as Aero from './aero.js';

const classic = Aero.makeAirfoil(11, 5);
const symmetric = Aero.makeAirfoil(12, 0);

/** Wing-frame point to world frame, as the views do. */
const toWorld = (flow, p) => ({ x: p.x * flow.ca + p.y * flow.sa, y: -p.x * flow.sa + p.y * flow.ca });

function velocity(af, flow, x, y) {
  const out = { u: 0, v: 0, inside: false };
  Aero.velocityWorld(af, flow, x, y, out);
  return out;
}

describe('makeAirfoil', () => {
  it('puts the trailing edge at x = 2 with a chord close to 4', () => {
    expect(classic.xTE).toBe(2);
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

describe('velocityWorld', () => {
  const flow = Aero.flowFor(classic, 5);

  it('recovers the free stream far from the wing', () => {
    const far = velocity(classic, flow, -200, 80);
    expect(far.u).toBeCloseTo(1, 2);
    expect(far.v).toBeCloseTo(0, 2);
  });

  it('flags points inside the wing', () => {
    const mid = toWorld(flow, { x: 0, y: (Aero.surfaceY(classic.upper, 0) + Aero.surfaceY(classic.lower, 0)) / 2 });
    expect(velocity(classic, flow, mid.x, mid.y).inside).toBe(true);
  });

  it('flows along the surface, not through it', () => {
    for (const i of [30, 60, 90, 150, 200]) {
      const a = classic.pts[i - 1],
        b = classic.pts[i + 1],
        p = classic.pts[i];
      const tl = Math.hypot(b.x - a.x, b.y - a.y);
      let nx = (b.y - a.y) / tl,
        ny = -(b.x - a.x) / tl;
      let q = toWorld(flow, { x: p.x + nx * 1e-3, y: p.y + ny * 1e-3 });
      if (velocity(classic, flow, q.x, q.y).inside) {
        nx = -nx;
        ny = -ny;
        q = toWorld(flow, { x: p.x + nx * 1e-3, y: p.y + ny * 1e-3 });
      }
      const v = velocity(classic, flow, q.x, q.y);
      const n = toWorld(flow, { x: nx, y: ny });
      expect(Math.abs(v.u * n.x + v.v * n.y)).toBeLessThan(0.05 * Math.hypot(v.u, v.v) + 0.02);
    }
  });

  it('leaves the trailing edge smoothly thanks to the Kutta condition', () => {
    const te = toWorld(flow, { x: classic.xTE + 0.0005, y: 0 });
    const kutta = velocity(classic, flow, te.x, te.y);
    expect(Math.hypot(kutta.u, kutta.v)).toBeLessThan(2);
    // Any other circulation wraps the flow around the sharp edge at a huge speed.
    const noCirculation = velocity(classic, { ...flow, G: 0 }, te.x, te.y);
    expect(Math.hypot(noCirculation.u, noCirculation.v)).toBeGreaterThan(5);
  });

  it('is faster over the upper surface than under the lower one when lifting', () => {
    const speedAt = (surface, x, side) => {
      const q = toWorld(flow, { x, y: Aero.surfaceY(surface, x) + side * 0.02 });
      const v = velocity(classic, flow, q.x, q.y);
      return Math.hypot(v.u, v.v);
    };
    for (const x of [-1, 0, 1]) expect(speedAt(classic.upper, x, 1)).toBeGreaterThan(speedAt(classic.lower, x, -1));
  });
});

describe('velocityClamped', () => {
  it('caps the speed at 3 and reports points inside the wing', () => {
    const flow = Aero.flowFor(classic, 5);
    const out = { u: 0, v: 0, inside: false };
    const te = toWorld(flow, { x: classic.xTE + 0.00005, y: 0 });
    expect(Aero.velocityClamped(classic, { ...flow, G: 0 }, te.x, te.y, out)).toBe(true);
    expect(Math.hypot(out.u, out.v)).toBeCloseTo(3, 6);
    const mid = toWorld(flow, { x: 0, y: 0.2 });
    expect(Aero.velocityClamped(classic, flow, mid.x, mid.y, out)).toBe(false);
  });
});

describe('stall wake', () => {
  it('only exists once stalled, and is strongest just behind the wing', () => {
    expect(Aero.stallWake(classic, Aero.flowFor(classic, 5), Aero.coefficients(classic, 5))).toBeNull();
    const flow = Aero.flowFor(classic, 20);
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
