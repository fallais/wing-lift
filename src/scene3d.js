// 3D view: a straight wing with the same 2D potential flow in every section. World frame: wind along +x, y up, z spanwise.
import * as THREE from 'three';
import * as Aero from './aero.js';

// The colours below are hand-picked display values: skip three's sRGB/linear conversions.
THREE.ColorManagement.enabled = false;

const X0 = -7, X1 = 9, Y0 = -4.5, Y1 = 4.5, HALF = 4;
const TARGET = new THREE.Vector3(1.2, 0.1, 0);
const DEFAULT_CAM = { th: -0.4, ph: 0.22, r: 16 };

const SPEED_BUCKETS = [0.6, 0.85, 0.95, 1.05, 1.2, 1.45, Infinity];
const SPEED_COLORS = ['#f97316', '#fdba74', '#f1e4d4', '#e2e8f0', '#bae6fd', '#7dd3fc', '#0ea5e9']
  .map(c => new THREE.Color(c));
const WING_RGB = [0.8, 0.84, 0.9], LOW_RGB = [0.23, 0.51, 0.96], HIGH_RGB = [0.94, 0.27, 0.27];

const FORCE_SCALE = 2.2;

// Throws when WebGL is unavailable: the caller then sticks to the 2D view.
export function create(stage, { onTilt }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x0b1220);
  const root = document.createElement('div');
  root.className = 'view';
  root.append(renderer.domElement);
  stage.prepend(root);
  let active = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55 * Math.PI));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75 * Math.PI);
  sun.position.set(-4, 10, 8);
  scene.add(sun);

  const tmp = { u: 0, v: 0, inside: false };
  let af, flow, aero, wake = null, show = {};
  let w = 0, h = 0;

  const wingToWorld = p => ({ x: p.x * flow.ca + p.y * flow.sa, y: -p.x * flow.sa + p.y * flow.ca });
  const sampleVelocity = (x, y) => Aero.velocityClamped(af, flow, x, y, tmp);

  // ---------- Wing: extruded airfoil, coloured by surface pressure ----------

  const wing = new THREE.Group();
  scene.add(wing);
  const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
  wingMat.side = THREE.DoubleSide;
  const capMat = new THREE.MeshStandardMaterial({ color: 0x8391a7, roughness: 0.6, side: THREE.DoubleSide });

  function buildWing() {
    wing.children.forEach(m => m.geometry.dispose());
    wing.clear();
    const pts = af.pts, n = pts.length;
    const pos = [], nor = [], col = [], idx = [];
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 2) % (n - 1)], b = pts[(i + 1) % (n - 1)];
      const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
      let nx = ty / tl, ny = -tx / tl;
      const rgb = surfaceColor(pts[i], nx, ny);
      if (rgb.flip) { nx = -nx; ny = -ny; }
      for (const z of [-HALF, HALF]) {
        pos.push(pts[i].x, pts[i].y, z);
        nor.push(nx, ny, 0);
        col.push(...rgb.c);
      }
      if (i < n - 1) {
        const k = 2 * i;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    wing.add(new THREE.Mesh(g, wingMat));

    const shape = new THREE.Shape(pts.slice(0, -1).map(p => new THREE.Vector2(p.x, p.y)));
    for (const z of [-HALF, HALF]) {
      const cap = new THREE.Mesh(new THREE.ShapeGeometry(shape), capMat);
      cap.position.z = z;
      wing.add(cap);
    }
    wing.rotation.z = -Math.atan2(flow.sa, flow.ca);
  }

  // Pressure just outside the skin, sampled a little along the outward normal.
  function surfaceColor(p, nx, ny) {
    let flip = false;
    let q = wingToWorld({ x: p.x + nx * 0.03, y: p.y + ny * 0.03 });
    Aero.velocityWorld(af, flow, q.x, q.y, tmp);
    if (tmp.inside) {
      flip = true;
      q = wingToWorld({ x: p.x - nx * 0.03, y: p.y - ny * 0.03 });
      Aero.velocityWorld(af, flow, q.x, q.y, tmp);
    }
    if (!show.pressure || tmp.inside) return { flip, c: WING_RGB };
    const cp = 1 - (tmp.u * tmp.u + tmp.v * tmp.v);
    const a = Math.min(1, cp < 0 ? -cp / 1.5 : cp), c = cp < 0 ? LOW_RGB : HIGH_RGB;
    return { flip, c: WING_RGB.map((v, k) => v * (1 - a) + c[k] * a) };
  }

  // ---------- Streamlines, repeated at a few spanwise stations ----------

  const streamMat = new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.35 });
  const streams = new THREE.LineSegments(new THREE.BufferGeometry(), streamMat);
  scene.add(streams);

  function buildStreamlines() {
    const seg = [];
    if (show.streamlines) {
      const step = 0.05, maxSteps = Math.ceil((X1 - X0) / step * 2);
      for (let y0 = Y0 + 0.15; y0 < Y1; y0 += 0.3) {
        const line = [];
        let x = X0, y = y0;
        line.push(x, y);
        for (let n = 0; n < maxSteps; n++) {
          if (!sampleVelocity(x, y)) break;
          let sp = Math.hypot(tmp.u, tmp.v);
          if (sp < 1e-3) break;
          if (!sampleVelocity(x + tmp.u / sp * step / 2, y + tmp.v / sp * step / 2)) break;
          sp = Math.hypot(tmp.u, tmp.v);
          x += tmp.u / sp * step;
          y += tmp.v / sp * step;
          line.push(x, y);
          if (x > X1 || y < Y0 - 1 || y > Y1 + 1) break;
        }
        for (const z of [-HALF + 0.5, 0, HALF - 0.5]) {
          for (let i = 2; i < line.length; i += 2) seg.push(line[i - 2], line[i - 1], z, line[i], line[i + 1], z);
        }
      }
    }
    streams.geometry.dispose();
    streams.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  }

  // ---------- Particles: short streaks coloured by speed ----------

  const COUNT = 3500;
  const px = new Float32Array(COUNT), py = new Float32Array(COUNT), pz = new Float32Array(COUNT);
  const phase = new Float32Array(COUNT), life = new Float32Array(COUNT);
  const streakPos = new Float32Array(COUNT * 6), streakCol = new Float32Array(COUNT * 6);
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3).setUsage(THREE.DynamicDrawUsage));
  streakGeo.setAttribute('color', new THREE.BufferAttribute(streakCol, 3).setUsage(THREE.DynamicDrawUsage));
  const particles = new THREE.LineSegments(streakGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
  particles.frustumCulled = false;
  scene.add(particles);

  function spawn(i, anywhere) {
    for (let tries = 0; tries < 10; tries++) {
      const x = anywhere ? X0 + Math.random() * (X1 - X0) : X0 - Math.random() * 0.3;
      const y = Y0 + Math.random() * (Y1 - Y0);
      if (sampleVelocity(x, y)) { px[i] = x; py[i] = y; break; }
    }
    pz[i] = -HALF + Math.random() * 2 * HALF;
    phase[i] = Math.random() * Math.PI * 2;
    life[i] = 15 + Math.random() * 20;
  }

  function stepParticles(dt, time, speed) {
    particles.visible = !!show.particles;
    if (!show.particles) return;
    // Capped so particles stay readable at airliner speeds.
    const speedFactor = Math.min(speed, 100) / 50;
    const k = speedFactor * 1.3 * dt;
    const tail = speedFactor * 0.25;

    for (let i = 0; i < COUNT; i++) {
      const x = px[i], y = py[i];
      life[i] -= dt * speedFactor;
      if (life[i] <= 0 || !sampleVelocity(x, y)) { spawn(i, life[i] <= 0); continue; }

      let u = tmp.u, v = tmp.v;
      if (sampleVelocity(x + u * k / 2, y + v * k / 2)) { u = tmp.u; v = tmp.v; }

      const wk = Aero.wakeIntensity(wake, x, y);
      if (wk > 0) {
        u = u * (1 - wk) + wk * (0.3 + 0.9 * Math.sin(3.1 * y - 5 * time + phase[i]));
        v = v * (1 - wk) + wk * 0.9 * Math.cos(2.7 * x - 4 * time + phase[i] * 1.7);
      }

      px[i] = x + u * k;
      py[i] = y + v * k;
      if (px[i] > X1 + 0.3 || py[i] < Y0 || py[i] > Y1) spawn(i, false);

      const sp = Math.hypot(u, v);
      let b = 0;
      while (sp > SPEED_BUCKETS[b]) b++;
      const c = SPEED_COLORS[b], o = i * 6;
      streakPos[o] = px[i] - u * tail; streakPos[o + 1] = py[i] - v * tail; streakPos[o + 2] = pz[i];
      streakPos[o + 3] = px[i]; streakPos[o + 4] = py[i]; streakPos[o + 5] = pz[i];
      streakCol[o] = c.r * 0.15; streakCol[o + 1] = c.g * 0.15; streakCol[o + 2] = c.b * 0.2;
      streakCol[o + 3] = c.r; streakCol[o + 4] = c.g; streakCol[o + 5] = c.b;
    }
    streakGeo.attributes.position.needsUpdate = true;
    streakGeo.attributes.color.needsUpdate = true;
  }

  // ---------- Angle of attack and force vectors, on the open (near) end of the wing ----------

  const ZF = HALF + 0.03;
  const labelsEl = document.createElement('div');
  labelsEl.className = 'tags';
  root.append(labelsEl);
  const labels = {};
  function makeLabel(key, cls, anchorEnd) {
    const el = document.createElement('div');
    el.className = `tag ${cls}${anchorEnd ? ' end' : ''}`;
    labelsEl.append(el);
    labels[key] = { el, at: new THREE.Vector3(), dx: 0, dy: 0, on: true };
  }
  makeLabel('alpha', 'alpha');
  makeLabel('lift', '', true);
  makeLabel('res', '');
  makeLabel('drag', '');
  makeLabel('weight', '', true);

  const refMat = new THREE.LineDashedMaterial({ color: 0x94a3b8, dashSize: 0.12, gapSize: 0.12, transparent: true, opacity: 0.7 });
  const refs = new THREE.LineSegments(new THREE.BufferGeometry(), refMat);
  const arc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xfbbf24 }));
  scene.add(refs, arc);

  function updateAngle(alphaDeg, text) {
    const te = wingToWorld({ x: af.xTE, y: 0 }), le = wingToWorld(af.le);
    const dir = { x: flow.ca, y: -flow.sa }, r = 1.3;
    refs.geometry.dispose();
    refs.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(le.x - 0.4, te.y, ZF), new THREE.Vector3(te.x + r * 1.3, te.y, ZF),
      new THREE.Vector3(te.x, te.y, ZF), new THREE.Vector3(te.x + dir.x * r * 1.3, te.y + dir.y * r * 1.3, ZF),
    ]);
    refs.computeLineDistances();

    const phi = Math.atan2(dir.y, dir.x), arcPts = [];
    for (let i = 0; i <= 24; i++) {
      const t = phi * i / 24;
      arcPts.push(new THREE.Vector3(te.x + r * Math.cos(t), te.y + r * Math.sin(t), ZF));
    }
    arc.geometry.dispose();
    arc.geometry = new THREE.BufferGeometry().setFromPoints(arcPts);
    arc.visible = Math.abs(alphaDeg) >= 0.5;

    const lb = labels.alpha;
    lb.at.set(te.x + r * 1.1 * Math.cos(phi / 2), te.y + r * 1.1 * Math.sin(phi / 2), ZF);
    lb.dx = 4; lb.dy = 0;
    lb.el.textContent = text;
  }

  function makeArrow(color) {
    const mat = new THREE.MeshBasicMaterial({ color });
    const shaftGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 12).translate(0, 0.5, 0);
    const headGeo = new THREE.ConeGeometry(0.13, 1, 16).translate(0, 0.5, 0);
    const g = new THREE.Group();
    g.shaft = new THREE.Mesh(shaftGeo, mat);
    g.head = new THREE.Mesh(headGeo, mat);
    g.add(g.shaft, g.head);
    forceGroup.add(g);
    return g;
  }

  const UP = new THREE.Vector3(0, 1, 0);
  function setArrow(g, from, to) {
    const d = new THREE.Vector3().subVectors(to, from), len = d.length();
    g.visible = len > 0.08;
    if (!g.visible) return;
    const hl = Math.min(0.35, len * 0.5);
    g.position.copy(from);
    g.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
    g.shaft.scale.y = len - hl;
    g.head.position.y = len - hl;
    g.head.scale.y = hl;
  }

  const forceGroup = new THREE.Group();
  scene.add(forceGroup);
  const arrows = {
    weight: makeArrow(0xc084fc), drag: makeArrow(0xf87171), lift: makeArrow(0x4ade80), res: makeArrow(0xfacc15),
  };
  const acDot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
  const comps = new THREE.LineSegments(new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: 0xfacc15, dashSize: 0.08, gapSize: 0.1, transparent: true, opacity: 0.5 }));
  forceGroup.add(acDot, comps);

  // Arrows are proportional to force; `perNewton` converts newtons to lift coefficient units.
  // Shrunk when needed so they stay inside the particle cloud.
  function updateForces(f, perNewton, texts) {
    const scale = FORCE_SCALE * perNewton;
    const a = wingToWorld(af.ac);
    const ac = new THREE.Vector3(a.x, a.y, ZF);
    const above = Math.max(f.lift, 0), below = Math.max(f.weight, -f.lift);
    const fit = Math.min(
      (Y1 - 0.8 - ac.y) / (above * scale || 1),
      (ac.y - Y0 - 0.3) / (below * scale || 1),
      5.5 / (f.drag * scale || 1),
    );
    const k = fit < 1 ? scale * Math.max(0, fit) : scale;

    const lift = new THREE.Vector3(ac.x, ac.y + f.lift * k, ZF);
    const drag = new THREE.Vector3(ac.x + f.drag * k, ac.y, ZF);
    const res = new THREE.Vector3(drag.x, lift.y, ZF);
    const weight = new THREE.Vector3(ac.x, ac.y - f.weight * k, ZF);
    setArrow(arrows.lift, ac, lift);
    setArrow(arrows.drag, ac, drag);
    setArrow(arrows.res, ac, res);
    setArrow(arrows.weight, ac, weight);
    acDot.position.copy(ac);
    comps.geometry.dispose();
    comps.geometry = new THREE.BufferGeometry().setFromPoints([lift, res, drag, res]);
    comps.computeLineDistances();

    const up = f.lift >= 0 ? -1 : 1;
    const place = (key, at, dx, dy) => Object.assign(labels[key], { dx, dy }).at.copy(at);
    place('lift', lift, -10, up * 2);
    place('res', res, 10, up * 2);
    place('drag', drag, 10, -up * 22);
    place('weight', weight, -10, -8);
    for (const key of ['lift', 'res', 'drag', 'weight']) labels[key].el.textContent = texts[key];
  }

  // ---------- Camera: drag to orbit, wheel to zoom, double-click to reset ----------

  const cam = { ...DEFAULT_CAM };
  function placeCamera() {
    // Pull back on narrow screens so the whole wing stays in frame.
    const r = cam.r * Math.max(1, 1.5 / (w / h || 1));
    camera.position.set(
      TARGET.x + r * Math.sin(cam.th) * Math.cos(cam.ph),
      TARGET.y + r * Math.sin(cam.ph),
      TARGET.z + r * Math.cos(cam.th) * Math.cos(cam.ph));
    camera.lookAt(TARGET);
  }

  let drag = null;
  stage.addEventListener('pointerdown', e => {
    if (!active) return;
    drag = { x: e.clientX, y: e.clientY, y0: e.clientY, tilt: e.shiftKey };
    if (drag.tilt) onTilt(0, true);
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.tilt) { onTilt(drag.y0 - e.clientY); return; }
    cam.th -= dx * 0.006;
    cam.ph = Math.max(-0.2, Math.min(1.3, cam.ph + dy * 0.006));
    placeCamera();
  });
  const endDrag = () => { drag = null; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('wheel', e => {
    if (!active) return;
    e.preventDefault();
    cam.r = Math.max(8, Math.min(40, cam.r * Math.exp(e.deltaY * 0.001)));
    placeCamera();
  }, { passive: false });
  stage.addEventListener('dblclick', () => { if (!active) return; Object.assign(cam, DEFAULT_CAM); placeCamera(); });

  const proj = new THREE.Vector3();
  function placeLabels() {
    for (const key in labels) {
      const lb = labels[key];
      const on = key === 'alpha' || show.forces;
      lb.el.style.display = on ? '' : 'none';
      if (!on) continue;
      proj.copy(lb.at).project(camera);
      lb.el.style.left = `${(proj.x + 1) / 2 * w + lb.dx}px`;
      lb.el.style.top = `${(1 - proj.y) / 2 * h + lb.dy}px`;
    }
  }

  return {
    setFlow(nextAf, nextFlow, nextAero, nextShow) {
      const first = !af;
      af = nextAf; flow = nextFlow; aero = nextAero; show = nextShow;
      if (first) for (let i = 0; i < COUNT; i++) spawn(i, true);
      wake = Aero.stallWake(af, flow, aero);
      buildWing();
      buildStreamlines();
    },
    setShow(nextShow) {
      show = nextShow;
      buildWing();
      buildStreamlines();
      forceGroup.visible = !!show.forces;
    },
    updateAngle,
    updateForces,
    setActive(on) {
      active = on;
      root.hidden = !on;
      drag = null;
    },
    resize() {
      w = stage.clientWidth; h = stage.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      placeCamera();
    },
    frame(dt, time, speed) {
      stepParticles(dt, time, speed);
      forceGroup.visible = !!show.forces;
      renderer.render(scene, camera);
      placeLabels();
    },
  };
}
