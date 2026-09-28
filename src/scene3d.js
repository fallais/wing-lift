// 3D view: a straight wing with the same 2D potential flow in every section. World frame: wind along +x, y up, z spanwise.
import * as THREE from 'three';
import * as Aero from './aero.js';
import { createParticles, SPEED_COLORS as SPEED_HEX } from './particles.js';
import { PRESSURE_GLSL, pressureUniforms } from './pressure.js';

// The colours below are hand-picked display values: skip three's sRGB/linear conversions.
THREE.ColorManagement.enabled = false;

const X0 = -7, X1 = 9, Y0 = -4.5, Y1 = 4.5, HALF = 4;
const TARGET = new THREE.Vector3(1.2, 0.1, 0);
const DEFAULT_CAM = { th: -0.4, ph: 0.22, r: 16 };

const SPEED_COLORS = SPEED_HEX.map(c => new THREE.Color(c));
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
  let af, flow, aero, show = {};
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

  // ---------- Particles: advected by the worker, drawn as short streaks coloured by speed ----------

  const COUNT = 3500;
  const flowParticles = createParticles();
  flowParticles.setBounds({ x0: X0, x1: X1, y0: Y0, y1: Y1 }, COUNT);
  // The flow is the same in every section, so each particle keeps its own spanwise station.
  const pz = Float32Array.from({ length: COUNT }, () => -HALF + Math.random() * 2 * HALF);
  const streakPos = new Float32Array(COUNT * 6), streakCol = new Float32Array(COUNT * 6);
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3).setUsage(THREE.DynamicDrawUsage));
  streakGeo.setAttribute('color', new THREE.BufferAttribute(streakCol, 3).setUsage(THREE.DynamicDrawUsage));
  const particles = new THREE.LineSegments(streakGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
  particles.frustumCulled = false;
  scene.add(particles);

  function drawParticles(frame, speed) {
    const { x, y, u, v, bucket } = frame;
    const tail = Math.min(speed, 100) / 50 * 0.25;
    for (let i = 0; i < COUNT; i++) {
      const o = i * 6;
      // Just respawned: park the streak out of sight until its next step.
      if (bucket[i] === 255) {
        streakPos[o + 1] = streakPos[o + 4] = -1000;
        continue;
      }
      const c = SPEED_COLORS[bucket[i]];
      streakPos[o] = x[i] - u[i] * tail; streakPos[o + 1] = y[i] - v[i] * tail; streakPos[o + 2] = pz[i];
      streakPos[o + 3] = x[i]; streakPos[o + 4] = y[i]; streakPos[o + 5] = pz[i];
      streakCol[o] = c.r * 0.15; streakCol[o + 1] = c.g * 0.15; streakCol[o + 2] = c.b * 0.2;
      streakCol[o + 3] = c.r; streakCol[o + 4] = c.g; streakCol[o + 5] = c.b;
    }
    streakGeo.attributes.position.needsUpdate = true;
    streakGeo.attributes.color.needsUpdate = true;
  }

  // ---------- Pressure: a see-through slice of the field at the near end of the wing ----------

  const pressureUniformValues = {
    uRot: { value: new THREE.Vector2(1, 0) },
    uCircle: { value: new THREE.Vector3() },
    uGamma: { value: 0 },
  };
  const pressureSlice = new THREE.Mesh(
    new THREE.PlaneGeometry(X1 - X0, Y1 - Y0),
    new THREE.ShaderMaterial({
      uniforms: pressureUniformValues,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vWorld;
        void main() {
          vWorld = (modelMatrix * vec4(position, 1.0)).xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vWorld;
        ${PRESSURE_GLSL}
        void main() {
          // Fade out towards the edges so the slice has no visible border.
          vec2 edge = min(vWorld - vec2(${X0.toFixed(1)}, ${Y0.toFixed(1)}), vec2(${X1.toFixed(1)}, ${Y1.toFixed(1)}) - vWorld);
          float fade = smoothstep(0.0, 2.5, min(edge.x, edge.y));
          gl_FragColor = pressureColor(pressureCoefficient(vWorld), 0.7 * fade);
        }`,
    }));
  pressureSlice.position.set((X0 + X1) / 2, (Y0 + Y1) / 2, HALF + 0.01);
  scene.add(pressureSlice);

  function updatePressureSlice() {
    const p = pressureUniforms(af, flow);
    pressureUniformValues.uRot.value.set(p.rot[0], p.rot[1]);
    pressureUniformValues.uCircle.value.set(p.circle[0], p.circle[1], p.circle[2]);
    pressureUniformValues.uGamma.value = p.gamma;
    pressureSlice.visible = !!show.pressure;
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
      af = nextAf; flow = nextFlow; aero = nextAero; show = nextShow;
      flowParticles.setFlow(af, flow, Aero.stallWake(af, flow, aero));
      updatePressureSlice();
      buildWing();
      buildStreamlines();
    },
    setShow(nextShow) {
      show = nextShow;
      buildWing();
      buildStreamlines();
      updatePressureSlice();
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
      particles.visible = !!show.particles;
      if (show.particles) {
        const frame = flowParticles.take();
        if (frame) drawParticles(frame, speed);
        flowParticles.step(dt, time, speed);
      }
      forceGroup.visible = !!show.forces;
      renderer.render(scene, camera);
      placeLabels();
    },
  };
}
