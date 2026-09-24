// Potential flow around a Joukowski airfoil, plus a simple empirical model
// for stall and drag. All flow velocities are normalised (freestream = 1).
(function () {
  'use strict';

  const DEG = Math.PI / 180;
  const VISCOUS_FACTOR = 0.85;
  const ASPECT_RATIO = 8;
  const OSWALD = 0.85;

  const PRESETS = {
    classic: { thickness: 11, camber: 5 },
    symmetric: { thickness: 12, camber: 0 },
    flat: { thickness: 1.5, camber: 0 },
    cambered: { thickness: 12, camber: 10 },
  };

  function surfaceY(list, x) {
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) {
        return a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
      }
    }
    return 0;
  }

  // Circle of centre (mx, my) through ζ = 1, mapped by z = ζ + 1/ζ.
  // Trailing edge lands at z = 2, chord is roughly 4.
  function makeAirfoil(thicknessPct, camberPct) {
    const eps = Math.max(0.004, thicknessPct / 100 / 1.299);
    const mx = -eps, my = 2 * camberPct / 100;
    const R = Math.hypot(1 - mx, my);
    const beta = Math.atan2(my, 1 - mx);

    const N = 240, pts = [];
    let iLE = 0;
    for (let i = 0; i <= N; i++) {
      const th = -beta + 2 * Math.PI * i / N;
      const zx = mx + R * Math.cos(th), zy = my + R * Math.sin(th);
      const m2 = zx * zx + zy * zy;
      pts.push({ x: zx + zx / m2, y: zy - zy / m2 });
      if (pts[i].x < pts[iLE].x) iLE = i;
    }

    const upper = pts.slice(0, iLE + 1);
    const lower = pts.slice(iLE);
    const le = pts[iLE], xTE = 2, chord = xTE - le.x;
    const xAC = le.x + chord / 4;

    return {
      thickness: thicknessPct / 100,
      mx, my, R, R2: R * R, beta,
      pts, upper, lower, le, xTE, chord,
      ac: { x: xAC, y: (surfaceY(upper, xAC) + surfaceY(lower, xAC)) / 2 },
    };
  }

  function coefficients(af, alphaDeg) {
    const betaDeg = af.beta / DEG;
    const stallAngle = Math.min(17, 9 + 50 * af.thickness);
    const stallPosEff = stallAngle + 0.8 * betaDeg;
    const stallNegEff = stallAngle - 0.2 * betaDeg;
    const linear = ae => VISCOUS_FACTOR * 8 * Math.PI * af.R * Math.sin(ae * DEG) / af.chord;

    const ae = alphaDeg + betaDeg;
    const side = ae >= 0 ? 1 : -1;
    const limit = side > 0 ? stallPosEff : stallNegEff;
    const over = Math.abs(ae) - limit;

    let CL = linear(ae), stall = 0;
    if (over > 0) {
      stall = Math.min(1, over / 6);
      const clMax = Math.abs(linear(limit));
      const flatPlate = 0.95 * Math.abs(Math.sin(2 * ae * DEG));
      CL = side * ((1 - stall) * clMax * (1 - 0.25 * stall) + stall * flatPlate);
    }

    const cd0 = 0.007 + 0.03 * af.thickness;
    const induced = CL * CL / (Math.PI * OSWALD * ASPECT_RATIO);
    const separated = stall * 1.6 * Math.sin(ae * DEG) ** 2;

    return {
      CL,
      CD: cd0 + induced + separated,
      stall,
      stallVis: over > 0 ? Math.min(1, 0.3 + over / 8) : 0,
      side,
      zeroLift: -betaDeg,
      stallPos: stallPosEff - betaDeg,
      stallNeg: -stallNegEff - betaDeg,
    };
  }

  // Kutta condition fixes the circulation so flow leaves the trailing edge smoothly.
  function flowFor(af, alphaDeg) {
    const a = alphaDeg * DEG;
    return { ca: Math.cos(a), sa: Math.sin(a), G: 2 * af.R * Math.sin(a + af.beta) };
  }

  // World frame: wind blows along +x, the wing is pitched nose-up by alpha.
  function velocityWorld(af, flow, x, y, out) {
    const { ca, sa, G } = flow;
    const zx = x * ca - y * sa, zy = x * sa + y * ca;

    // Inverse Joukowski: keep the root outside the circle.
    const ax = zx * zx - zy * zy - 4, ay = 2 * zx * zy;
    const r = Math.hypot(ax, ay);
    const sx = Math.sqrt(Math.max(0, (r + ax) / 2));
    const sy = Math.sqrt(Math.max(0, (r - ax) / 2)) * (ay < 0 ? -1 : 1);
    let px = (zx + sx) / 2, py = (zy + sy) / 2;
    let dx = px - af.mx, dy = py - af.my, dd = dx * dx + dy * dy;
    const qx = (zx - sx) / 2, qy = (zy - sy) / 2;
    const ex = qx - af.mx, ey = qy - af.my, ee = ex * ex + ey * ey;
    if (ee > dd) { px = qx; py = qy; dx = ex; dy = ey; dd = ee; }

    if (dd < af.R2) { out.inside = true; return; }
    out.inside = false;

    // dW/dζ = e^{-iα} - R² e^{iα} / (ζ-μ)² + iG / (ζ-μ)
    const d2x = dx * dx - dy * dy, d2y = 2 * dx * dy, d4 = d2x * d2x + d2y * d2y;
    const tx = af.R2 * (ca * d2x + sa * d2y) / d4;
    const ty = af.R2 * (sa * d2x - ca * d2y) / d4;
    const wx = ca - tx + G * dy / dd;
    const wy = -sa - ty + G * dx / dd;

    // dz/dζ = 1 - 1/ζ²
    const p2x = px * px - py * py, p2y = 2 * px * py, p4 = p2x * p2x + p2y * p2y;
    const jx = 1 - p2x / p4, jy = p2y / p4, j2 = jx * jx + jy * jy;

    const u = (wx * jx + wy * jy) / j2;
    const v = -(wy * jx - wx * jy) / j2;
    out.u = u * ca + v * sa;
    out.v = -u * sa + v * ca;
  }

  function airDensity(altitude) {
    return 1.225 * Math.pow(1 - 2.25577e-5 * altitude, 4.2559);
  }

  window.Aero = {
    PRESETS, ASPECT_RATIO,
    makeAirfoil, coefficients, flowFor, velocityWorld, airDensity, surfaceY,
  };
})();
