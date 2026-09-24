(function () {
  'use strict';

  const Aero = window.Aero;
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
      dClassic: "Extrados bombé, intrados presque plat : le profil d'un avion léger. Il porte même à 0°.",
      dSymmetric: 'Même courbure dessus et dessous : aucune portance à 0°. Avions de voltige, dérives.',
      dFlat: 'Une simple plaque : elle porte un peu, mais décroche tôt.',
      dCambered: 'Forte courbure : beaucoup de portance à basse vitesse (planeurs lents, oiseaux).',
      dCustom: 'Profil personnalisé : réglez épaisseur et cambrure.',
      thickness: 'Épaisseur',
      camber: 'Cambrure',
      flight: 'Vol',
      alpha: 'Incidence α',
      speed: 'Vitesse V',
      altitude: 'Altitude',
      area: 'Surface alaire S',
      display: 'Affichage',
      showParticles: 'Particules',
      showStreamlines: 'Lignes de courant',
      showPressure: 'Pression',
      showForces: 'Forces',
      results: 'Résultats',
      rCl: 'Cz (portance)',
      rCd: 'Cx (traînée)',
      rLd: 'Finesse Cz/Cx',
      rQ: 'Pression dynamique q',
      rLift: 'Portance',
      rDrag: 'Traînée',
      rRes: 'Résultante',
      rMass: 'Masse soutenue',
      chart: 'Courbe Cz(α)',
      stall: 'Décrochage !',
      hint: "Glissez verticalement pour incliner l'aile",
      legSlow: 'lent', legFast: 'rapide', legLow: 'dépression', legHigh: 'surpression',
      wind: 'Vent relatif',
      lift: 'Portance', drag: 'Traînée', res: 'Résultante',
      cl: 'Cz', liftSym: 'P',
      caption: (z, s) => `Portance nulle à α = ${z}° · décrochage vers ${s}°`,
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
      dClassic: 'Curved top, nearly flat bottom: a typical light aircraft airfoil. It lifts even at 0°.',
      dSymmetric: 'Same curve on both sides: no lift at 0°. Aerobatic planes, tail fins.',
      dFlat: 'A simple plate: it lifts a little, but stalls early.',
      dCambered: 'Strong curvature: lots of lift at low speed (slow gliders, birds).',
      dCustom: 'Custom airfoil: set thickness and camber yourself.',
      thickness: 'Thickness',
      camber: 'Camber',
      flight: 'Flight',
      alpha: 'Angle of attack α',
      speed: 'Airspeed V',
      altitude: 'Altitude',
      area: 'Wing area S',
      display: 'Display',
      showParticles: 'Particles',
      showStreamlines: 'Streamlines',
      showPressure: 'Pressure',
      showForces: 'Forces',
      results: 'Results',
      rCl: 'CL (lift)',
      rCd: 'CD (drag)',
      rLd: 'Lift-to-drag L/D',
      rQ: 'Dynamic pressure q',
      rLift: 'Lift',
      rDrag: 'Drag',
      rRes: 'Resultant',
      rMass: 'Supported mass',
      chart: 'CL(α) curve',
      stall: 'Stall!',
      hint: 'Drag vertically to tilt the wing',
      legSlow: 'slow', legFast: 'fast', legLow: 'low pressure', legHigh: 'high pressure',
      wind: 'Relative wind',
      lift: 'Lift', drag: 'Drag', res: 'Resultant',
      cl: 'CL', liftSym: 'L',
      caption: (z, s) => `Zero lift at α = ${z}° · stall around ${s}°`,
    },
  };

  const SPEED_BUCKETS = [0.6, 0.85, 0.95, 1.05, 1.2, 1.45, Infinity];
  const SPEED_COLORS = ['#f97316', '#fdba74', '#f1e4d4', '#e2e8f0', '#bae6fd', '#7dd3fc', '#0ea5e9'];

  const state = {
    lang: 'fr',
    thickness: 11,
    camber: 5,
    alpha: 5,
    speed: 50,
    altitude: 0,
    area: 16,
    show: { particles: true, streamlines: false, pressure: true, forces: true },
  };

  const $ = id => document.getElementById(id);
  const stage = $('stage');
  const bgCtx = $('bg').getContext('2d');
  const fxCtx = $('fx').getContext('2d');
  const svg = $('overlay');
  const pressureCanvas = document.createElement('canvas');
  const tmp = { u: 0, v: 0, inside: false };

  const view = { w: 0, h: 0, s: 1, cx: 0, cy: 0, x0: 0, x1: 0, y0: 0, y1: 0 };
  let af, aero, flow, wake = null;
  let staticDirty = true;
  let time = 0;

  const tr = key => I18N[state.lang][key];
  const fmt = (n, d = 0) => n.toLocaleString(state.lang, { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtForce = n => Math.abs(n) >= 1000 ? `${fmt(n / 1000, 2)} kN` : `${fmt(n)} N`;
  const fmtMass = kg => Math.abs(kg) >= 1000 ? `${fmt(kg / 1000, 2)} t` : `${fmt(kg)} kg`;

  const wingToWorld = p => ({ x: p.x * flow.ca + p.y * flow.sa, y: -p.x * flow.sa + p.y * flow.ca });
  const toScreen = p => ({ x: view.cx + p.x * view.s, y: view.cy - p.y * view.s });
  const wingToScreen = p => toScreen(wingToWorld(p));
  const sx = x => view.cx + x * view.s;
  const sy = y => view.cy - y * view.s;

  function forces() {
    const rho = Aero.airDensity(state.altitude);
    const q = 0.5 * rho * state.speed ** 2;
    const lift = q * state.area * aero.CL;
    const drag = q * state.area * aero.CD;
    return { rho, q, lift, drag, res: Math.hypot(lift, drag) };
  }

  // ---------- Simulation state ----------

  function updateShape() {
    af = Aero.makeAirfoil(state.thickness, state.camber);
    updateAlpha();
  }

  function updateAlpha() {
    aero = Aero.coefficients(af, state.alpha);
    flow = Aero.flowFor(af, state.alpha);
    updateWake();
    staticDirty = true;
    render();
  }

  function render() {
    drawOverlay();
    drawChart();
    updateReadouts();
  }

  // Region behind the separation point where particles get turbulent.
  function updateWake() {
    if (!aero.stallVis) { wake = null; return; }
    const xs = af.xTE - (0.2 + 0.55 * aero.stallVis) * af.chord;
    const surface = aero.side > 0 ? af.upper : af.lower;
    const S = wingToWorld({ x: xs, y: Aero.surfaceY(surface, xs) });
    const T = wingToWorld({ x: af.xTE, y: 0 });
    wake = {
      x0: S.x,
      top: Math.max(S.y, T.y) + 0.1,
      bot: Math.min(S.y, T.y) - 0.1,
      spreadUp: aero.side > 0 ? 0.22 : 0.08,
      spreadDown: aero.side > 0 ? 0.08 : 0.22,
      len: 2.5 + 6 * aero.stallVis,
      k: aero.stallVis,
    };
  }

  function wakeIntensity(x, y) {
    if (!wake) return 0;
    const d = x - wake.x0;
    if (d < 0 || d > wake.len) return 0;
    const edge = Math.min(wake.top + wake.spreadUp * d - y, y - wake.bot + wake.spreadDown * d);
    if (edge <= 0) return 0;
    return Math.min(0.9, 1.2 * wake.k * (1 - d / wake.len)) * Math.min(1, edge / 0.4);
  }

  function sampleVelocity(x, y) {
    Aero.velocityWorld(af, flow, x, y, tmp);
    if (tmp.inside) return false;
    const sp = Math.hypot(tmp.u, tmp.v);
    if (sp > 3) { tmp.u *= 3 / sp; tmp.v *= 3 / sp; }
    return true;
  }

  // ---------- Particles ----------

  let count = 0, px, py, ox, oy, phase, life, bucket;

  function initParticles() {
    count = Math.round(Math.min(3500, view.w * view.h / 380));
    px = new Float32Array(count);
    py = new Float32Array(count);
    ox = new Float32Array(count);
    oy = new Float32Array(count);
    phase = new Float32Array(count);
    life = new Float32Array(count);
    bucket = new Uint8Array(count);
    for (let i = 0; i < count; i++) spawn(i, true);
    fxCtx.clearRect(0, 0, view.w, view.h);
  }

  function spawn(i, anywhere) {
    for (let tries = 0; tries < 10; tries++) {
      const x = anywhere ? view.x0 + Math.random() * (view.x1 - view.x0) : view.x0 - Math.random() * 0.3;
      const y = view.y0 + Math.random() * (view.y1 - view.y0);
      if (sampleVelocity(x, y)) { px[i] = ox[i] = x; py[i] = oy[i] = y; break; }
    }
    phase[i] = Math.random() * Math.PI * 2;
    life[i] = 8 + Math.random() * 12;
    bucket[i] = 255;
  }

  function stepParticles(dt) {
    const ctx = fxCtx;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.globalCompositeOperation = 'source-over';
    if (!state.show.particles) return;

    const speedFactor = state.speed / 50;
    const k = speedFactor * 3.2 * dt;

    for (let i = 0; i < count; i++) {
      const x = px[i], y = py[i];
      life[i] -= dt * speedFactor;
      if (life[i] <= 0 || !sampleVelocity(x, y)) { spawn(i, life[i] <= 0); continue; }

      let u = tmp.u, v = tmp.v;
      if (sampleVelocity(x + u * k / 2, y + v * k / 2)) { u = tmp.u; v = tmp.v; }

      const w = wakeIntensity(x, y);
      if (w > 0) {
        u = u * (1 - w) + w * (0.3 + 0.9 * Math.sin(3.1 * y - 5 * time + phase[i]));
        v = v * (1 - w) + w * 0.9 * Math.cos(2.7 * x - 4 * time + phase[i] * 1.7);
      }

      ox[i] = x; oy[i] = y;
      px[i] = x + u * k;
      py[i] = y + v * k;

      const sp = Math.hypot(u, v);
      let b = 0;
      while (sp > SPEED_BUCKETS[b]) b++;
      bucket[i] = b;

      if (px[i] > view.x1 + 0.3 || py[i] < view.y0 - 0.5 || py[i] > view.y1 + 0.5) spawn(i, false);
    }

    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (let b = 0; b < SPEED_COLORS.length; b++) {
      ctx.strokeStyle = SPEED_COLORS[b];
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        if (bucket[i] !== b) continue;
        ctx.moveTo(sx(ox[i]), sy(oy[i]));
        ctx.lineTo(sx(px[i]), sy(py[i]));
      }
      ctx.stroke();
    }
  }

  // ---------- Static layer: pressure map & streamlines ----------

  function drawStatic() {
    staticDirty = false;
    bgCtx.clearRect(0, 0, view.w, view.h);
    if (state.show.pressure) drawPressure();
    if (state.show.streamlines) drawStreamlines();
  }

  function drawPressure() {
    const cell = 5;
    const gw = Math.ceil(view.w / cell), gh = Math.ceil(view.h / cell);
    pressureCanvas.width = gw;
    pressureCanvas.height = gh;
    const pctx = pressureCanvas.getContext('2d');
    const img = pctx.createImageData(gw, gh);
    const d = img.data;

    // Cells inside the wing reuse the last outside value to avoid a dark halo.
    for (let j = 0; j < gh; j++) {
      const y = view.y1 - (j + 0.5) * cell / view.s;
      let cp = 0;
      for (let i = 0; i < gw; i++) {
        const x = view.x0 + (i + 0.5) * cell / view.s;
        Aero.velocityWorld(af, flow, x, y, tmp);
        if (!tmp.inside) cp = 1 - (tmp.u * tmp.u + tmp.v * tmp.v);
        const o = (j * gw + i) * 4;
        if (cp < 0) {
          d[o] = 59; d[o + 1] = 130; d[o + 2] = 246;
          d[o + 3] = 200 * Math.min(1, -cp / 1.5);
        } else {
          d[o] = 239; d[o + 1] = 68; d[o + 2] = 68;
          d[o + 3] = 200 * Math.min(1, cp);
        }
      }
    }
    pctx.putImageData(img, 0, 0);
    bgCtx.imageSmoothingEnabled = true;
    bgCtx.drawImage(pressureCanvas, 0, 0, view.w, view.h);
  }

  function drawStreamlines() {
    const h = 0.05;
    const maxSteps = Math.ceil((view.x1 - view.x0) / h * 2);
    const ctx = bgCtx;
    ctx.strokeStyle = 'rgba(226,232,240,0.35)';
    ctx.lineWidth = 1;

    for (let y0 = view.y0 + 0.15; y0 < view.y1; y0 += 0.3) {
      let x = view.x0, y = y0;
      ctx.beginPath();
      ctx.moveTo(sx(x), sy(y));
      for (let n = 0; n < maxSteps; n++) {
        if (!sampleVelocity(x, y)) break;
        let sp = Math.hypot(tmp.u, tmp.v);
        if (sp < 1e-3) break;
        if (!sampleVelocity(x + tmp.u / sp * h / 2, y + tmp.v / sp * h / 2)) break;
        sp = Math.hypot(tmp.u, tmp.v);
        x += tmp.u / sp * h;
        y += tmp.v / sp * h;
        ctx.lineTo(sx(x), sy(y));
        if (x > view.x1 || y < view.y0 - 1 || y > view.y1 + 1) break;
      }
      ctx.stroke();
    }
  }

  // ---------- SVG overlay: wing, angle, forces ----------

  function buildOverlay() {
    const arrow = (id, cls) => `<g id="${id}" class="arrow ${cls}"><line/><path/></g>`;
    svg.innerHTML = `
      <defs>
        <linearGradient id="wingGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f1f5f9"/><stop offset="1" stop-color="#8391a7"/>
        </linearGradient>
      </defs>
      <line id="horizon" class="ref"/>
      <line id="chordLine" class="ref"/>
      <path id="alphaArc" class="arc"/>
      <text id="alphaLabel" class="lbl alpha"/>
      ${arrow('arrWind', 'wind')}
      <path id="wing" class="wing"/>
      <g id="forces">
        <line id="compL" class="comp"/><line id="compD" class="comp"/>
        ${arrow('arrDrag', 'drag')}${arrow('arrLift', 'lift')}${arrow('arrRes', 'res')}
        <circle id="acDot" class="ac" r="4"/>
        <text id="liftLabel" class="lbl" text-anchor="end"/>
        <text id="dragLabel" class="lbl"/>
        <text id="resLabel" class="lbl"/>
      </g>`;
  }

  const attr = (el, values) => { for (const k in values) el.setAttribute(k, values[k]); };

  function setArrow(id, x1, y1, x2, y2) {
    const g = $(id);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    g.style.display = len < 4 ? 'none' : '';
    if (len < 4) return;
    const ux = dx / len, uy = dy / len;
    const hl = Math.min(13, len * 0.5), hw = hl * 0.55;
    const bx = x2 - ux * hl, by = y2 - uy * hl;
    attr(g.querySelector('line'), { x1, y1, x2: bx, y2: by });
    g.querySelector('path').setAttribute('d',
      `M${x2} ${y2}L${bx - uy * hw} ${by + ux * hw}L${bx + uy * hw} ${by - ux * hw}Z`);
  }

  function setLabel(id, x, y, text) {
    const el = $(id);
    attr(el, { x, y });
    el.textContent = text;
  }

  function drawOverlay() {
    if (!view.w) return;

    $('wing').setAttribute('d', af.pts.map((p, i) => {
      const q = wingToScreen(p);
      return `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    }).join('') + 'Z');

    // Angle of attack: horizontal vs chord line, measured at the trailing edge.
    const te = wingToScreen({ x: af.xTE, y: 0 });
    const le = wingToScreen(af.le);
    const cl = Math.hypot(te.x - le.x, te.y - le.y);
    const dir = { x: (te.x - le.x) / cl, y: (te.y - le.y) / cl };
    const r = 1.3 * view.s;
    attr($('horizon'), { x1: le.x - 0.4 * view.s, y1: te.y, x2: te.x + r * 1.3, y2: te.y });
    attr($('chordLine'), { x1: te.x, y1: te.y, x2: te.x + dir.x * r * 1.3, y2: te.y + dir.y * r * 1.3 });
    const phi = Math.atan2(dir.y, dir.x);
    const showArc = Math.abs(state.alpha) >= 0.5;
    $('alphaArc').setAttribute('d', showArc
      ? `M${te.x + r} ${te.y}A${r} ${r} 0 0 ${phi > 0 ? 1 : 0} ${te.x + r * dir.x} ${te.y + r * dir.y}` : '');
    setLabel('alphaLabel', te.x + r * 1.08 * Math.cos(phi / 2) + 4, te.y + r * 1.08 * Math.sin(phi / 2) + 4,
      `α = ${fmt(state.alpha, 1)}°`);

    setArrow('arrWind', 18, 60, 18 + 20 + state.speed * 1.6, 60);

    const group = $('forces');
    group.style.display = state.show.forces ? '' : 'none';
    if (!state.show.forces) return;

    // Arrows are proportional to force: 1 unit of coefficient ≈ 1.5 chord-quarters at 50 m/s, 16 m².
    const f = forces();
    let k = 1.5 * view.s / Q_REF;
    const maxLen = 0.42 * view.h;
    const longest = Math.max(Math.abs(f.lift), Math.abs(f.drag), f.res) * k;
    if (longest > maxLen) k *= maxLen / longest;

    const ac = wingToScreen(af.ac);
    const lift = { x: ac.x, y: ac.y - f.lift * k };
    const drag = { x: ac.x + f.drag * k, y: ac.y };
    const res = { x: drag.x, y: lift.y };

    attr($('compL'), { x1: lift.x, y1: lift.y, x2: res.x, y2: res.y });
    attr($('compD'), { x1: drag.x, y1: drag.y, x2: res.x, y2: res.y });
    setArrow('arrLift', ac.x, ac.y, lift.x, lift.y);
    setArrow('arrDrag', ac.x, ac.y, drag.x, drag.y);
    setArrow('arrRes', ac.x, ac.y, res.x, res.y);
    attr($('acDot'), { cx: ac.x, cy: ac.y });

    const up = f.lift >= 0 ? -1 : 1;
    setLabel('liftLabel', lift.x - 10, lift.y + up * 2 + 4, `${tr('lift')} ${fmtForce(f.lift)}`);
    setLabel('resLabel', res.x + 10, res.y + up * 2 + 4, `${tr('res')} ${fmtForce(f.res)}`);
    setLabel('dragLabel', drag.x + 10, drag.y - up * 26, `${tr('drag')} ${fmtForce(f.drag)}`);
  }

  // ---------- Panel ----------

  function drawChart() {
    const W = 300, H = 170, L = 30, R = 8, T = 8, B = 20;
    const A0 = -20, A1 = 25, C0 = -1.6, C1 = 2.4;
    const X = a => L + (a - A0) / (A1 - A0) * (W - L - R);
    const Y = c => T + (C1 - c) / (C1 - C0) * (H - T - B);

    let s = '';
    s += `<rect class="zone" x="${X(Math.min(A1, aero.stallPos))}" y="${T}" width="${Math.max(0, X(A1) - X(aero.stallPos))}" height="${H - T - B}"/>`;
    s += `<rect class="zone" x="${X(A0)}" y="${T}" width="${Math.max(0, X(aero.stallNeg) - X(A0))}" height="${H - T - B}"/>`;
    for (const a of [-20, -10, 0, 10, 20]) {
      s += `<line class="${a ? 'grid' : 'axis'}" x1="${X(a)}" x2="${X(a)}" y1="${T}" y2="${H - B}"/>`;
      s += `<text x="${X(a)}" y="${H - 6}" text-anchor="middle">${a}°</text>`;
    }
    for (const c of [-1, 0, 1, 2]) {
      s += `<line class="${c ? 'grid' : 'axis'}" x1="${L}" x2="${W - R}" y1="${Y(c)}" y2="${Y(c)}"/>`;
      s += `<text x="${L - 5}" y="${Y(c) + 3}" text-anchor="end">${c}</text>`;
    }

    const pts = [];
    for (let a = A0; a <= A1; a += 0.5) pts.push(`${X(a).toFixed(1)},${Y(Aero.coefficients(af, a).CL).toFixed(1)}`);
    s += `<polyline class="curve" points="${pts.join(' ')}"/>`;
    s += `<text x="${L + 4}" y="${T + 10}">${tr('cl')}</text><text x="${W - R - 2}" y="${Y(0) - 4}" text-anchor="end">α</text>`;

    const cx = X(state.alpha), cy = Y(aero.CL);
    s += `<line class="guide" x1="${cx}" x2="${cx}" y1="${H - B}" y2="${cy}"/>`;
    s += `<circle class="dot" cx="${cx}" cy="${cy}" r="5"/>`;
    $('chart').innerHTML = s;

    $('chartCaption').textContent = tr('caption')(fmt(aero.zeroLift, 1), fmt(aero.stallPos, 1));
  }

  function updateReadouts() {
    const f = forces();
    $('outThickness').textContent = `${fmt(state.thickness, 1)} %`;
    $('outCamber').textContent = `${fmt(state.camber, 1)} %`;
    $('outAlpha').textContent = `${fmt(state.alpha, 1)}°`;
    const speedText = `${fmt(state.speed)} m/s · ${fmt(state.speed * 3.6)} km/h`;
    $('outSpeed').textContent = speedText;
    $('windOut').textContent = speedText;
    $('outAltitude').textContent = `${fmt(state.altitude)} m · ρ = ${fmt(f.rho, 3)} kg/m³`;
    $('outArea').textContent = `${fmt(state.area, 1)} m²`;

    $('rCl').textContent = fmt(aero.CL, 2);
    $('rCd').textContent = fmt(aero.CD, 3);
    $('rLd').textContent = fmt(aero.CL / aero.CD, 1);
    $('rQ').textContent = `${fmt(f.q)} Pa`;
    $('rLift').textContent = fmtForce(f.lift);
    $('rDrag').textContent = fmtForce(f.drag);
    $('rRes').textContent = fmtForce(f.res);
    $('rMass').textContent = fmtMass(f.lift / G);

    $('formula').textContent =
      `${tr('liftSym')} = ½ · ρ · V² · S · ${tr('cl')}\n` +
      `= ½ · ${fmt(f.rho, 3)} · ${fmt(state.speed)}² · ${fmt(state.area, 1)} · ${fmt(aero.CL, 2)}\n` +
      `≈ ${fmtForce(f.lift)}`;

    $('stallBadge').classList.toggle('on', aero.stall > 0);
    updatePresetUI();
  }

  function updatePresetUI() {
    let current = 'custom';
    for (const [name, p] of Object.entries(Aero.PRESETS)) {
      if (p.thickness === state.thickness && p.camber === state.camber) current = name;
    }
    document.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('active', b.dataset.preset === current));
    $('presetDesc').textContent = tr('d' + current[0].toUpperCase() + current.slice(1));
  }

  function applyLanguage() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = tr(el.dataset.i18n); });
    document.querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('active', b.dataset.lang === state.lang));
    document.title = tr('title');
    try { localStorage.setItem('lang', state.lang); } catch (e) { /* storage unavailable */ }
    render();
  }

  function updateLegend() {
    $('legendSpeed').hidden = !state.show.particles;
    $('legendPressure').hidden = !state.show.pressure;
  }

  // ---------- Wiring ----------

  function setAlpha(value) {
    state.alpha = Math.round(Math.max(-20, Math.min(25, value)) * 10) / 10;
    $('alpha').value = state.alpha;
    updateAlpha();
  }

  function bindControls() {
    const ranges = {
      thickness: updateShape,
      camber: updateShape,
      alpha: updateAlpha,
      speed: render,
      altitude: render,
      area: render,
    };
    for (const [key, onChange] of Object.entries(ranges)) {
      const input = $(key);
      input.value = state[key];
      input.addEventListener('input', () => { state[key] = +input.value; onChange(); });
    }

    document.querySelectorAll('[data-preset]').forEach(btn => btn.addEventListener('click', () => {
      Object.assign(state, Aero.PRESETS[btn.dataset.preset]);
      $('thickness').value = state.thickness;
      $('camber').value = state.camber;
      updateShape();
    }));

    document.querySelectorAll('[data-show]').forEach(box => {
      box.checked = state.show[box.dataset.show];
      box.addEventListener('change', () => {
        state.show[box.dataset.show] = box.checked;
        staticDirty = true;
        updateLegend();
        drawOverlay();
      });
    });

    document.querySelectorAll('[data-lang]').forEach(btn => btn.addEventListener('click', () => {
      state.lang = btn.dataset.lang;
      applyLanguage();
    }));

    const setSpeed = v => {
      state.speed = Math.max(0, Math.min(100, v));
      $('speed').value = state.speed;
      render();
    };
    $('windDown').addEventListener('click', () => setSpeed(state.speed - 5));
    $('windUp').addEventListener('click', () => setSpeed(state.speed + 5));
    document.querySelector('.wind-ctrl').addEventListener('pointerdown', e => e.stopPropagation());

    $('helpBtn').addEventListener('click', () => $('help').showModal());
    $('help').addEventListener('click', e => { if (e.target === $('help')) $('help').close(); });

    let drag = null;
    stage.addEventListener('pointerdown', e => {
      drag = { y: e.clientY, alpha: state.alpha };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
      if (drag) setAlpha(drag.alpha + (drag.y - e.clientY) * 0.12);
    });
    const endDrag = () => { drag = null; };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      setAlpha(state.alpha - Math.sign(e.deltaY) * 0.5);
    }, { passive: false });
  }

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const ctx of [bgCtx, fxCtx]) {
      ctx.canvas.width = Math.round(w * dpr);
      ctx.canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    Object.assign(view, { w, h, s: Math.min(w / (w < 640 ? 8 : 11.5), h / 7), cx: w * (w < 640 ? 0.55 : 0.45), cy: h * 0.5 });
    view.x0 = -view.cx / view.s;
    view.x1 = (w - view.cx) / view.s;
    view.y0 = -(h - view.cy) / view.s;
    view.y1 = view.cy / view.s;

    initParticles();
    staticDirty = true;
    drawOverlay();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    if (view.w && view.h) {
      if (staticDirty) drawStatic();
      stepParticles(dt);
    }
    requestAnimationFrame(frame);
  }

  try { state.lang = localStorage.getItem('lang') || (navigator.language.startsWith('fr') ? 'fr' : 'en'); } catch (e) { /* default */ }

  buildOverlay();
  bindControls();
  updateShape();
  updateLegend();
  applyLanguage();
  new ResizeObserver(resize).observe(stage);
  requestAnimationFrame(frame);
})();
