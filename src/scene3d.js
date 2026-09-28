// 3D view: a straight wing with the same 2D potential flow in every section. World frame: wind along +x, y up, z spanwise.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as Aero from './aero.js';
import { createParticles, SPEED_COLORS as SPEED_HEX } from './particles.js';
import { PRESSURE_GLSL, pressureUniforms } from './pressure.js';

// The colours below are hand-picked display values: skip three's sRGB/linear conversions.
THREE.ColorManagement.enabled = false;

const X0 = -7,
  X1 = 9,
  Y0 = -4.5,
  Y1 = 4.5,
  HALF = 4;
const TARGET = new THREE.Vector3(1.2, 0.1, 0);
const DEFAULT_CAM = { th: -0.4, ph: 0.22, r: 16 };

const SPEED_COLORS = SPEED_HEX.map(c => new THREE.Color(c));
const WING_RGB = [0.8, 0.84, 0.9],
  LOW_RGB = [0.23, 0.51, 0.96],
  HIGH_RGB = [0.94, 0.27, 0.27];

const FORCE_SCALE = 2.2;

// Throws when WebGL is unavailable: the caller then sticks to the 2D view.
/**
 * @param {HTMLElement} stage
 * @param {import('./view.js').ViewInput} input
 * @returns {import('./view.js').View}
 */
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
  /** @type {import('./aero.js').Airfoil} */
  let af;
  /** @type {import('./aero.js').Flow} */
  let flow;
  /** @type {import('./aero.js').Coefficients} */
  let aero;
  /** @type {import('./view.js').Show} */
  let show = { particles: false, streamlines: false, pressure: false, forces: false };
  let w = 0,
    h = 0;

  const wingToWorld = p => ({ x: p.x * flow.ca + p.y * flow.sa, y: -p.x * flow.sa + p.y * flow.ca });
  const sampleVelocity = (x, y) => Aero.velocityClamped(af.field, flow, x, y, tmp);

  // ---------- Wing: extruded airfoil, coloured by surface pressure ----------

  const wing = new THREE.Group();
  scene.add(wing);
  const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 });
  wingMat.side = THREE.DoubleSide;
  const capMat = new THREE.MeshStandardMaterial({ color: 0x8391a7, roughness: 0.6, side: THREE.DoubleSide });

  function buildWing() {
    wing.children.forEach(m => /** @type {THREE.Mesh} */ (m).geometry.dispose());
    wing.clear();
    const pts = af.pts,
      n = pts.length;
    const pos = [],
      nor = [],
      col = [],
      idx = [];
    const cp = Aero.surfacePressure(af, flow);
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 2) % (n - 1)],
        b = pts[(i + 1) % (n - 1)];
      const tx = b.x - a.x,
        ty = b.y - a.y,
        tl = Math.hypot(tx, ty) || 1;
      // Outward normal of the counter-clockwise outline.
      const nx = ty / tl,
        ny = -tx / tl;
      const rgb = surfaceColor(cp[i]);
      for (const z of [-HALF, HALF]) {
        pos.push(pts[i].x, pts[i].y, z);
        nor.push(nx, ny, 0);
        col.push(...rgb);
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

  /** @param {number} cp surface pressure coefficient, from the panel solution */
  function surfaceColor(cp) {
    if (!show.pressure) return WING_RGB;
    const a = Math.min(1, cp < 0 ? -cp / 1.5 : cp),
      c = cp < 0 ? LOW_RGB : HIGH_RGB;
    return WING_RGB.map((v, k) => v * (1 - a) + c[k] * a);
  }

  // ---------- Streamlines, repeated at a few spanwise stations ----------

  const streamMat = new THREE.LineBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.35 });
  const streams = new THREE.LineSegments(new THREE.BufferGeometry(), streamMat);
  scene.add(streams);

  function buildStreamlines() {
    const seg = [];
    if (show.streamlines) {
      const step = 0.05,
        maxSteps = Math.ceil(((X1 - X0) / step) * 2);
      for (let y0 = Y0 + 0.15; y0 < Y1; y0 += 0.3) {
        const line = [];
        let x = X0,
          y = y0;
        line.push(x, y);
        for (let n = 0; n < maxSteps; n++) {
          if (!sampleVelocity(x, y)) break;
          let sp = Math.hypot(tmp.u, tmp.v);
          if (sp < 1e-3) break;
          if (!sampleVelocity(x + ((tmp.u / sp) * step) / 2, y + ((tmp.v / sp) * step) / 2)) break;
          sp = Math.hypot(tmp.u, tmp.v);
          x += (tmp.u / sp) * step;
          y += (tmp.v / sp) * step;
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
  const streakPos = new Float32Array(COUNT * 6),
    streakCol = new Float32Array(COUNT * 6);
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3).setUsage(THREE.DynamicDrawUsage));
  streakGeo.setAttribute('color', new THREE.BufferAttribute(streakCol, 3).setUsage(THREE.DynamicDrawUsage));
  const particles = new THREE.LineSegments(
    streakGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }),
  );
  particles.frustumCulled = false;
  scene.add(particles);

  function drawParticles(frame, speed) {
    const { x, y, u, v, bucket } = frame;
    const tail = (Math.min(speed, 100) / 50) * 0.25;
    for (let i = 0; i < COUNT; i++) {
      const o = i * 6;
      // Just respawned: park the streak out of sight until its next step.
      if (bucket[i] === 255) {
        streakPos[o + 1] = streakPos[o + 4] = -1000;
        continue;
      }
      const c = SPEED_COLORS[bucket[i]];
      streakPos[o] = x[i] - u[i] * tail;
      streakPos[o + 1] = y[i] - v[i] * tail;
      streakPos[o + 2] = pz[i];
      streakPos[o + 3] = x[i];
      streakPos[o + 4] = y[i];
      streakPos[o + 5] = pz[i];
      streakCol[o] = c.r * 0.15;
      streakCol[o + 1] = c.g * 0.15;
      streakCol[o + 2] = c.b * 0.2;
      streakCol[o + 3] = c.r;
      streakCol[o + 4] = c.g;
      streakCol[o + 5] = c.b;
    }
    streakGeo.attributes.position.needsUpdate = true;
    streakGeo.attributes.color.needsUpdate = true;
  }

  // ---------- Pressure: a see-through slice of the field at the near end of the wing ----------

  const pressureUniformValues = {
    uRot: { value: new THREE.Vector2(1, 0) },
    uFine: { value: /** @type {THREE.DataTexture | null} */ (null) },
    uFineGrid: { value: new THREE.Vector3() },
    uFineSize: { value: new THREE.Vector2() },
    uCoarse: { value: /** @type {THREE.DataTexture | null} */ (null) },
    uCoarseGrid: { value: new THREE.Vector3() },
    uCoarseSize: { value: new THREE.Vector2() },
    uCirculation: { value: new THREE.Vector2() },
    uCentre: { value: new THREE.Vector2() },
  };
  /** @type {import('./aero.js').FlowField | null} */
  let uploadedField = null;

  /** @param {import('./aero.js').Grid} grid */
  function gridTexture(grid) {
    const t = new THREE.DataTexture(grid.tex, grid.nx, grid.ny, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }
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
    }),
  );
  // Just behind the end cap: the wing itself hides the slice along its exact outline.
  pressureSlice.position.set((X0 + X1) / 2, (Y0 + Y1) / 2, HALF - 0.01);
  scene.add(pressureSlice);

  function updatePressureSlice() {
    const u = pressureUniformValues;
    if (uploadedField !== af.field) {
      u.uFine.value?.dispose();
      u.uCoarse.value?.dispose();
      u.uFine.value = gridTexture(af.field.fine);
      u.uCoarse.value = gridTexture(af.field.coarse);
      uploadedField = af.field;
    }
    const p = pressureUniforms(af.field, flow);
    u.uRot.value.fromArray(p.rot);
    u.uFineGrid.value.fromArray(p.fineGrid);
    u.uFineSize.value.fromArray(p.fineSize);
    u.uCoarseGrid.value.fromArray(p.coarseGrid);
    u.uCoarseSize.value.fromArray(p.coarseSize);
    u.uCirculation.value.fromArray(p.circulation);
    u.uCentre.value.fromArray(p.centre);
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

  const refMat = new THREE.LineDashedMaterial({
    color: 0x94a3b8,
    dashSize: 0.12,
    gapSize: 0.12,
    transparent: true,
    opacity: 0.7,
  });
  const refs = new THREE.LineSegments(new THREE.BufferGeometry(), refMat);
  const arc = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xfbbf24 }));
  scene.add(refs, arc);

  function updateAngle(alphaDeg, text) {
    const te = wingToWorld({ x: af.xTE, y: 0 }),
      le = wingToWorld(af.le);
    const dir = { x: flow.ca, y: -flow.sa },
      r = 1.3;
    refs.geometry.dispose();
    refs.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(le.x - 0.4, te.y, ZF),
      new THREE.Vector3(te.x + r * 1.3, te.y, ZF),
      new THREE.Vector3(te.x, te.y, ZF),
      new THREE.Vector3(te.x + dir.x * r * 1.3, te.y + dir.y * r * 1.3, ZF),
    ]);
    refs.computeLineDistances();

    const phi = Math.atan2(dir.y, dir.x),
      arcPts = [];
    for (let i = 0; i <= 24; i++) {
      const t = (phi * i) / 24;
      arcPts.push(new THREE.Vector3(te.x + r * Math.cos(t), te.y + r * Math.sin(t), ZF));
    }
    arc.geometry.dispose();
    arc.geometry = new THREE.BufferGeometry().setFromPoints(arcPts);
    arc.visible = Math.abs(alphaDeg) >= 0.5;

    const lb = labels.alpha;
    lb.at.set(te.x + r * 1.1 * Math.cos(phi / 2), te.y + r * 1.1 * Math.sin(phi / 2), ZF);
    lb.dx = 4;
    lb.dy = 0;
    lb.el.textContent = text;
  }

  function makeArrow(color) {
    const mat = new THREE.MeshBasicMaterial({ color });
    const shaftGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 12).translate(0, 0.5, 0);
    const headGeo = new THREE.ConeGeometry(0.13, 1, 16).translate(0, 0.5, 0);
    const group = new THREE.Group();
    const shaft = new THREE.Mesh(shaftGeo, mat);
    const head = new THREE.Mesh(headGeo, mat);
    group.add(shaft, head);
    forceGroup.add(group);
    return { group, shaft, head };
  }

  const UP = new THREE.Vector3(0, 1, 0);
  /**
   * @param {ReturnType<typeof makeArrow>} arrow
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   */
  function setArrow({ group, shaft, head }, from, to) {
    const d = new THREE.Vector3().subVectors(to, from),
      len = d.length();
    group.visible = len > 0.08;
    if (!group.visible) return;
    const hl = Math.min(0.35, len * 0.5);
    group.position.copy(from);
    group.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
    shaft.scale.y = len - hl;
    head.position.y = len - hl;
    head.scale.y = hl;
  }

  const forceGroup = new THREE.Group();
  scene.add(forceGroup);
  const arrows = {
    weight: makeArrow(0xc084fc),
    drag: makeArrow(0xf87171),
    lift: makeArrow(0x4ade80),
    res: makeArrow(0xfacc15),
  };
  const acDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
  );
  const comps = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineDashedMaterial({ color: 0xfacc15, dashSize: 0.08, gapSize: 0.1, transparent: true, opacity: 0.5 }),
  );
  forceGroup.add(acDot, comps);

  // Arrows are proportional to force; `perNewton` converts newtons to lift coefficient units.
  // Shrunk when needed so they stay inside the particle cloud.
  function updateForces(f, perNewton, texts) {
    const scale = FORCE_SCALE * perNewton;
    const a = wingToWorld(af.ac);
    const ac = new THREE.Vector3(a.x, a.y, ZF);
    const above = Math.max(f.lift, 0),
      below = Math.max(f.weight, -f.lift);
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

  // ---------- Camera: OrbitControls (drag or one finger to orbit, wheel or pinch to zoom) ----------

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(TARGET);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.rotateSpeed = 0.7;
  // Elevation between slightly below the wing and almost overhead.
  controls.minPolarAngle = Math.PI / 2 - 1.3;
  controls.maxPolarAngle = Math.PI / 2 + 0.2;
  controls.minDistance = 8;
  // Until the user moves the camera, resizing keeps the default framing.
  let userMoved = false;
  controls.addEventListener('start', () => (userMoved = true));

  // Pull back on narrow screens so the whole wing stays in frame.
  const fitFactor = () => Math.max(1, 1.5 / (w / h || 1));

  function placeDefaultCamera() {
    const { th, ph } = DEFAULT_CAM,
      r = DEFAULT_CAM.r * fitFactor();
    camera.position.set(
      TARGET.x + r * Math.sin(th) * Math.cos(ph),
      TARGET.y + r * Math.sin(ph),
      TARGET.z + r * Math.cos(th) * Math.cos(ph),
    );
    controls.target.copy(TARGET);
    controls.update();
  }

  // Shift + drag tilts the wing instead. Capture phase, so it runs before OrbitControls.
  let tilt = null;
  stage.addEventListener(
    'pointerdown',
    e => {
      if (!active || !e.shiftKey) return;
      tilt = { y0: e.clientY };
      controls.enabled = false;
      onTilt(0, true);
    },
    { capture: true },
  );
  stage.addEventListener('pointermove', e => {
    if (tilt) onTilt(tilt.y0 - e.clientY);
  });
  const endTilt = () => {
    tilt = null;
    controls.enabled = active;
  };
  stage.addEventListener('pointerup', endTilt);
  stage.addEventListener('pointercancel', endTilt);
  stage.addEventListener('dblclick', () => {
    if (!active) return;
    userMoved = false;
    placeDefaultCamera();
  });

  const proj = new THREE.Vector3();
  function placeLabels() {
    for (const key in labels) {
      const lb = labels[key];
      const on = key === 'alpha' || show.forces;
      lb.el.style.display = on ? '' : 'none';
      if (!on) continue;
      proj.copy(lb.at).project(camera);
      lb.el.style.left = `${((proj.x + 1) / 2) * w + lb.dx}px`;
      lb.el.style.top = `${((1 - proj.y) / 2) * h + lb.dy}px`;
    }
  }

  return {
    setFlow(nextAf, nextFlow, nextAero, nextShow) {
      af = nextAf;
      flow = nextFlow;
      aero = nextAero;
      show = nextShow;
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
      tilt = null;
      controls.enabled = on;
    },
    resize() {
      w = stage.clientWidth;
      h = stage.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      controls.maxDistance = 40 * fitFactor();
      if (!userMoved) placeDefaultCamera();
    },
    frame(dt, time, speed) {
      particles.visible = !!show.particles;
      if (show.particles) {
        const frame = flowParticles.take();
        if (frame) drawParticles(frame, speed);
        flowParticles.step(dt, time, speed);
      }
      forceGroup.visible = !!show.forces;
      controls.update(dt);
      renderer.render(scene, camera);
      placeLabels();
    },
  };
}
