// Advects the flow particles off the main thread. The page sends the flow and a
// buffer; the worker fills it with positions, velocities and colour buckets and
// hands it back.
import { velocityClamped, wakeIntensity } from './aero.js';
import { SPEED_BUCKETS, layout } from './particle-frame.js';

/** @typedef {import('./aero.js').Flow} Flow */
/** @typedef {import('./aero.js').Wake} Wake */
/** @typedef {import('./particle-frame.js').Bounds} Bounds */

/** @type {import('./aero.js').FlowField | null} */
let field = null;
/** @type {Flow | null} */
let flow = null;
/** @type {Wake | null} */
let wake = null;
/** @type {Bounds} */
let bounds = { x0: 0, x1: 0, y0: 0, y1: 0 };
let count = 0;
let x = new Float32Array(0),
  y = new Float32Array(0),
  phase = new Float32Array(0),
  life = new Float32Array(0);
let spawned = false;
const tmp = { u: 0, v: 0, inside: false };

/** @param {number} px @param {number} py */
const sample = (px, py) => velocityClamped(field, flow, px, py, tmp);

/** @param {number} i @param {boolean} anywhere */
function spawn(i, anywhere) {
  const { x0, x1, y0, y1 } = bounds;
  for (let tries = 0; tries < 10; tries++) {
    const px = anywhere ? x0 + Math.random() * (x1 - x0) : x0 - Math.random() * 0.3;
    const py = y0 + Math.random() * (y1 - y0);
    if (sample(px, py)) {
      x[i] = px;
      y[i] = py;
      break;
    }
  }
  phase[i] = Math.random() * Math.PI * 2;
  life[i] = 15 + Math.random() * 20;
}

function spawnAll() {
  for (let i = 0; i < count; i++) spawn(i, true);
  spawned = true;
}

/**
 * @param {ArrayBuffer} buffer
 * @param {number} dt
 * @param {number} time
 * @param {number} speed airspeed in m/s
 */
function step(buffer, dt, time, speed) {
  const out = layout(buffer, count);
  // Capped so particles stay readable at airliner speeds.
  const speedFactor = Math.min(speed, 100) / 50;
  const k = speedFactor * 1.3 * dt;
  const { x1, y0, y1 } = bounds;

  for (let i = 0; i < count; i++) {
    const px = x[i],
      py = y[i];
    life[i] -= dt * speedFactor;
    if (life[i] <= 0 || !sample(px, py)) {
      spawn(i, life[i] <= 0);
      out.bucket[i] = 255;
      continue;
    }

    let u = tmp.u,
      v = tmp.v;
    if (sample(px + (u * k) / 2, py + (v * k) / 2)) {
      u = tmp.u;
      v = tmp.v;
    }

    const w = wakeIntensity(wake, px, py);
    if (w > 0) {
      u = u * (1 - w) + w * (0.3 + 0.9 * Math.sin(3.1 * py - 5 * time + phase[i]));
      v = v * (1 - w) + w * 0.9 * Math.cos(2.7 * px - 4 * time + phase[i] * 1.7);
    }

    x[i] = px + u * k;
    y[i] = py + v * k;
    out.x[i] = x[i];
    out.y[i] = y[i];
    out.u[i] = u;
    out.v[i] = v;

    const sp = Math.hypot(u, v);
    let b = 0;
    while (sp > SPEED_BUCKETS[b]) b++;
    out.bucket[i] = b;

    if (x[i] > x1 + 0.3 || y[i] < y0 - 0.5 || y[i] > y1 + 0.5) spawn(i, false);
  }
  return k;
}

self.onmessage = ({ data }) => {
  switch (data.type) {
    case 'bounds':
      bounds = data.bounds;
      count = data.count;
      x = new Float32Array(count);
      y = new Float32Array(count);
      phase = new Float32Array(count);
      life = new Float32Array(count);
      spawned = false;
      if (field && flow) spawnAll();
      break;
    case 'field':
      field = data.field;
      break;
    case 'flow':
      flow = data.flow;
      wake = data.wake;
      if (field && !spawned) spawnAll();
      break;
    case 'step': {
      const ready = field && flow && data.count === count;
      const k = ready ? step(data.buffer, data.dt, data.time, data.speed) : 0;
      self.postMessage({ buffer: data.buffer, count: data.count, k, ready }, { transfer: [data.buffer] });
      break;
    }
  }
};
