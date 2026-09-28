// 2D view of a wing section: Canvas for the flow, SVG for the wing and vectors.
// Same interface as Scene3D.
(function () {
  'use strict';

  const Aero = window.Aero;
  const FORCE_SCALE = 1.5;

  const SPEED_BUCKETS = [0.6, 0.85, 0.95, 1.05, 1.2, 1.45, Infinity];
  const SPEED_COLORS = ['#f97316', '#fdba74', '#f1e4d4', '#e2e8f0', '#bae6fd', '#7dd3fc', '#0ea5e9'].map(c => c + 'c0');

  function create(stage, { onTilt, onNudge }) {
    const root = document.createElement('div');
    root.className = 'view';
    root.innerHTML = '<canvas></canvas><canvas></canvas><svg aria-hidden="true"></svg>';
    stage.prepend(root);
    const [bgCanvas, fxCanvas] = root.querySelectorAll('canvas');
    const bgCtx = bgCanvas.getContext('2d');
    const fxCtx = fxCanvas.getContext('2d');
    const svg = root.querySelector('svg');
    const pressureCanvas = document.createElement('canvas');
    const tmp = { u: 0, v: 0, inside: false };

    const view = { w: 0, h: 0, s: 1, cx: 0, cy: 0, x0: 0, x1: 0, y0: 0, y1: 0 };
    let af, flow, wake = null, show = {};
    let staticDirty = true, active = true;
    let lastAngle = null, lastForces = null;

    const wingToWorld = p => ({ x: p.x * flow.ca + p.y * flow.sa, y: -p.x * flow.sa + p.y * flow.ca });
    const toScreen = p => ({ x: view.cx + p.x * view.s, y: view.cy - p.y * view.s });
    const wingToScreen = p => toScreen(wingToWorld(p));
    const sx = x => view.cx + x * view.s;
    const sy = y => view.cy - y * view.s;
    const sampleVelocity = (x, y) => Aero.velocityClamped(af, flow, x, y, tmp);

    // ---------- Particles ----------

    let count = 0, px, py, ox, oy, phase, life, bucket;

    function initParticles() {
      count = Math.round(Math.min(3500, view.w * view.h / 900));
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
      life[i] = 15 + Math.random() * 20;
      bucket[i] = 255;
    }

    function stepParticles(dt, time, speed) {
      const ctx = fxCtx;
      if (!show.particles) return;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.globalCompositeOperation = 'source-over';

      // Capped so particles stay readable at airliner speeds.
      const speedFactor = Math.min(speed, 100) / 50;
      const k = speedFactor * 1.3 * dt;

      for (let i = 0; i < count; i++) {
        const x = px[i], y = py[i];
        life[i] -= dt * speedFactor;
        if (life[i] <= 0 || !sampleVelocity(x, y)) { spawn(i, life[i] <= 0); continue; }

        let u = tmp.u, v = tmp.v;
        if (sampleVelocity(x + u * k / 2, y + v * k / 2)) { u = tmp.u; v = tmp.v; }

        const w = Aero.wakeIntensity(wake, x, y);
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

      ctx.lineWidth = 1.3;
      ctx.lineCap = 'butt';
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
      if (show.pressure) drawPressure();
      if (show.streamlines) drawStreamlines();
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

    const arrowMarkup = (id, cls) => `<g data-id="${id}" class="arrow ${cls}"><line/><path/></g>`;
    svg.innerHTML = `
      <defs>
        <linearGradient id="wingGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f1f5f9"/><stop offset="1" stop-color="#8391a7"/>
        </linearGradient>
      </defs>
      <line data-id="horizon" class="ref"/>
      <line data-id="chordLine" class="ref"/>
      <path data-id="alphaArc" class="arc"/>
      <text data-id="alphaLabel" class="lbl alpha"/>
      <path data-id="wing" class="wing"/>
      <g data-id="forces">
        <line data-id="compL" class="comp"/><line data-id="compD" class="comp"/>
        ${arrowMarkup('arrWeight', 'weight')}${arrowMarkup('arrDrag', 'drag')}${arrowMarkup('arrLift', 'lift')}${arrowMarkup('arrRes', 'res')}
        <circle data-id="acDot" class="ac" r="4"/>
        <text data-id="liftLabel" class="lbl" text-anchor="end"/>
        <text data-id="dragLabel" class="lbl"/>
        <text data-id="resLabel" class="lbl"/>
        <text data-id="weightLabel" class="lbl" text-anchor="end"/>
      </g>`;
    const el = {};
    svg.querySelectorAll('[data-id]').forEach(n => { el[n.dataset.id] = n; });

    const attr = (node, values) => { for (const k in values) node.setAttribute(k, values[k]); };

    function setArrow(id, x1, y1, x2, y2) {
      const g = el[id];
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
      attr(el[id], { x, y });
      el[id].textContent = text;
    }

    function updateAngle(alphaDeg, text) {
      lastAngle = [alphaDeg, text];
      if (!view.w || !af) return;

      el.wing.setAttribute('d', af.pts.map((p, i) => {
        const q = wingToScreen(p);
        return `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
      }).join('') + 'Z');

      // Angle of attack: horizontal vs chord line, measured at the trailing edge.
      const te = wingToScreen({ x: af.xTE, y: 0 });
      const le = wingToScreen(af.le);
      const cl = Math.hypot(te.x - le.x, te.y - le.y);
      const dir = { x: (te.x - le.x) / cl, y: (te.y - le.y) / cl };
      const r = 1.3 * view.s;
      attr(el.horizon, { x1: le.x - 0.4 * view.s, y1: te.y, x2: te.x + r * 1.3, y2: te.y });
      attr(el.chordLine, { x1: te.x, y1: te.y, x2: te.x + dir.x * r * 1.3, y2: te.y + dir.y * r * 1.3 });
      const phi = Math.atan2(dir.y, dir.x);
      el.alphaArc.setAttribute('d', Math.abs(alphaDeg) >= 0.5
        ? `M${te.x + r} ${te.y}A${r} ${r} 0 0 ${phi > 0 ? 1 : 0} ${te.x + r * dir.x} ${te.y + r * dir.y}` : '');
      setLabel('alphaLabel', te.x + r * 1.08 * Math.cos(phi / 2) + 4, te.y + r * 1.08 * Math.sin(phi / 2) + 4, text);
    }

    // Arrows are proportional to force; `perNewton` converts newtons to lift coefficient units.
    // Shrunk when needed so they stay clear of the results strip (top) and the legend (bottom).
    function updateForces(f, perNewton, texts) {
      lastForces = [f, perNewton, texts];
      el.forces.style.display = show.forces ? '' : 'none';
      if (!view.w || !af || !show.forces) return;

      const ac = wingToScreen(af.ac);
      let k = FORCE_SCALE * view.s * perNewton;
      const above = Math.max(f.lift, 0), below = Math.max(f.weight, -f.lift);
      const fit = Math.min(
        (ac.y - 120) / (above * k || 1),
        (view.h - ac.y - 150) / (below * k || 1),
        0.42 * view.w / (f.drag * k || 1),
      );
      if (fit < 1) k *= Math.max(0, fit);

      const lift = { x: ac.x, y: ac.y - f.lift * k };
      const drag = { x: ac.x + f.drag * k, y: ac.y };
      const res = { x: drag.x, y: lift.y };
      const weight = { x: ac.x, y: ac.y + f.weight * k };

      attr(el.compL, { x1: lift.x, y1: lift.y, x2: res.x, y2: res.y });
      attr(el.compD, { x1: drag.x, y1: drag.y, x2: res.x, y2: res.y });
      setArrow('arrLift', ac.x, ac.y, lift.x, lift.y);
      setArrow('arrDrag', ac.x, ac.y, drag.x, drag.y);
      setArrow('arrRes', ac.x, ac.y, res.x, res.y);
      setArrow('arrWeight', ac.x, ac.y, weight.x, weight.y);
      attr(el.acDot, { cx: ac.x, cy: ac.y });

      const up = f.lift >= 0 ? -1 : 1;
      setLabel('liftLabel', lift.x - 10, lift.y + up * 2 + 4, texts.lift);
      setLabel('resLabel', res.x + 10, res.y + up * 2 + 4, texts.res);
      setLabel('dragLabel', drag.x + 10, drag.y - up * 26, texts.drag);
      setLabel('weightLabel', weight.x - 10, weight.y - 2, texts.weight);
    }

    function redrawOverlay() {
      if (lastAngle) updateAngle(...lastAngle);
      if (lastForces) updateForces(...lastForces);
    }

    // ---------- Input: drag vertically or scroll to tilt the wing ----------

    let drag = null;
    stage.addEventListener('pointerdown', e => {
      if (!active) return;
      drag = { y: e.clientY };
      onTilt(0, true);
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
      if (drag) onTilt(drag.y - e.clientY);
    });
    const endDrag = () => { drag = null; };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('wheel', e => {
      if (!active) return;
      e.preventDefault();
      onNudge(-Math.sign(e.deltaY));
    }, { passive: false });

    return {
      setFlow(nextAf, nextFlow, nextAero, nextShow) {
        af = nextAf; flow = nextFlow; show = nextShow;
        wake = Aero.stallWake(af, flow, nextAero);
        if (!count && view.w) initParticles();
        staticDirty = true;
      },
      setShow(nextShow) {
        show = nextShow;
        if (!show.particles) fxCtx.clearRect(0, 0, view.w, view.h);
        staticDirty = true;
        redrawOverlay();
      },
      updateAngle,
      updateForces,
      setActive(on) {
        active = on;
        root.hidden = !on;
        drag = null;
      },
      resize() {
        const w = stage.clientWidth, h = stage.clientHeight;
        // Particles are redrawn every frame: keep that canvas at 1x to spare the GPU.
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        for (const [ctx, scale] of [[bgCtx, dpr], [fxCtx, 1]]) {
          ctx.canvas.width = Math.round(w * scale);
          ctx.canvas.height = Math.round(h * scale);
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
        }
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

        Object.assign(view, { w, h, s: Math.min(w / (w < 640 ? 8 : 11.5), h / 7), cx: w * (w < 640 ? 0.55 : 0.45), cy: h * 0.5 });
        view.x0 = -view.cx / view.s;
        view.x1 = (w - view.cx) / view.s;
        view.y0 = -(h - view.cy) / view.s;
        view.y1 = view.cy / view.s;

        if (af) initParticles();
        staticDirty = true;
        redrawOverlay();
      },
      frame(dt, time, speed) {
        if (!af) return;
        if (staticDirty) drawStatic();
        stepParticles(dt, time, speed);
      },
    };
  }

  window.Scene2D = { create };
})();
