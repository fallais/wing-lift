// Advects the flow particles off the main thread. The page sends the flow and a
// buffer; the worker fills it with positions, velocities and colour buckets and
// hands it back.
//
// In 2D the particles live in the airfoil section. In 3D (a finite wing of half span
// `half`), the section flow applies along the span and fades past the tips, the tip
// vortices add their swirl, and particles move spanwise too.
import {
  tipVortexVelocity,
  velocityClamped,
  wakeIntensity,
  type Flow,
  type FlowField,
  type TipVortices,
  type Wake,
} from './aero';
import { SPEED_BUCKETS, layout, type FromParticleWorker, type ToParticleWorker } from './particle-frame';

// The DOM typings describe `self` as a window; the worker scope has the same messaging API as a Worker.
const scope = self as unknown as Worker;

let field: FlowField | null = null;
let flow: Flow | null = null;
let wake: Wake | null = null;
let vortices: TipVortices | null = null;
let bounds = { x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 };
/** Half span of the 3D wing; 0 in 2D. */
let half = 0;
let count = 0;
let x = new Float32Array(0),
  y = new Float32Array(0),
  z = new Float32Array(0),
  phase = new Float32Array(0),
  life = new Float32Array(0);
let spawned = false;
const tmp = { u: 0, v: 0, inside: false };
const vel = { u: 0, v: 0, w: 0 };
// Share of the 3D particles released around the tips, where the vortices are.
const TIP_SHARE = 0.4;
// Past the tips, the section flow fades out over this distance.
const TIP_FADE = 1.5;

/** Velocity at a point into `vel`; false inside the wing. */
function sample(px: number, py: number, pz: number): boolean {
  if (!field || !flow) return false;
  if (!half) {
    if (!velocityClamped(field, flow, px, py, tmp)) return false;
    vel.u = tmp.u;
    vel.v = tmp.v;
    vel.w = 0;
    return true;
  }
  const beyond = Math.abs(pz) - half;
  const s = beyond <= 0 ? 1 : Math.exp(-((beyond / TIP_FADE) ** 2));
  vel.u = 1;
  vel.v = 0;
  vel.w = 0;
  if (s > 1e-3) {
    const ok = velocityClamped(field, flow, px, py, tmp);
    if (!ok && beyond <= 0) return false;
    // Past the tip there is no wing: its section outline does not block anything.
    if (ok) {
      vel.u = 1 + s * (tmp.u - 1);
      vel.v = s * tmp.v;
    }
  }
  if (vortices) {
    const [, v, w] = tipVortexVelocity(vortices, px, py, pz);
    vel.v += v;
    vel.w += w;
  }
  const sp = Math.hypot(vel.u, vel.v, vel.w);
  if (sp > 3) {
    vel.u *= 3 / sp;
    vel.v *= 3 / sp;
    vel.w *= 3 / sp;
  }
  return true;
}

/** Normal random number, for the clouds released around the tips. */
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

function spawn(i: number, anywhere: boolean) {
  const { x0, x1, y0, y1, z0, z1 } = bounds;
  // Tips inside the particle box (only the left one when the view shows the left half-wing).
  const tips = [-half, half].filter(t => t >= z0 - 1 && t <= z1 + 1);
  const nearTip = half > 0 && vortices && tips.length > 0 && Math.random() < TIP_SHARE;
  for (let tries = 0; tries < 10; tries++) {
    const px = anywhere ? x0 + Math.random() * (x1 - x0) : x0 - Math.random() * 0.3;
    let py = y0 + Math.random() * (y1 - y0),
      pz = z0 + Math.random() * (z1 - z0);
    if (nearTip) {
      py = gauss() * 1.2;
      pz = tips[Math.floor(Math.random() * tips.length)] + gauss() * 1.2;
    }
    if (sample(px, py, pz)) {
      x[i] = px;
      y[i] = py;
      z[i] = pz;
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

/** Moves every particle by one frame; `speed` is the airspeed in m/s. Returns the step factor k. */
function step(buffer: ArrayBuffer, dt: number, time: number, speed: number): number {
  const out = layout(buffer, count);
  // Capped so particles stay readable at airliner speeds.
  const speedFactor = Math.min(speed, 100) / 50;
  const k = speedFactor * 1.3 * dt;
  const { x1, y0, y1, z0, z1 } = bounds;

  for (let i = 0; i < count; i++) {
    const px = x[i],
      py = y[i],
      pz = z[i];
    life[i] -= dt * speedFactor;
    if (life[i] <= 0 || !sample(px, py, pz)) {
      spawn(i, life[i] <= 0);
      out.bucket[i] = 255;
      continue;
    }

    let u = vel.u,
      v = vel.v,
      w = vel.w;
    if (sample(px + (u * k) / 2, py + (v * k) / 2, pz + (w * k) / 2)) {
      u = vel.u;
      v = vel.v;
      w = vel.w;
    }

    // The stall wake only exists behind the wing, not past its tips.
    const turb = !half || Math.abs(pz) < half ? wakeIntensity(wake, px, py) : 0;
    if (turb > 0) {
      u = u * (1 - turb) + turb * (0.3 + 0.9 * Math.sin(3.1 * py - 5 * time + phase[i]));
      v = v * (1 - turb) + turb * 0.9 * Math.cos(2.7 * px - 4 * time + phase[i] * 1.7);
    }

    x[i] = px + u * k;
    y[i] = py + v * k;
    z[i] = pz + w * k;
    out.x[i] = x[i];
    out.y[i] = y[i];
    out.z[i] = z[i];
    out.u[i] = u;
    out.v[i] = v;
    out.w[i] = w;

    const sp = Math.hypot(u, v, w);
    let b = 0;
    while (sp > SPEED_BUCKETS[b]) b++;
    out.bucket[i] = b;

    const outside = y[i] < y0 - 0.5 || y[i] > y1 + 0.5 || (half > 0 && (z[i] < z0 - 0.5 || z[i] > z1 + 0.5));
    if (x[i] > x1 + 0.3 || outside) spawn(i, false);
  }
  return k;
}

scope.onmessage = ({ data }: MessageEvent<ToParticleWorker>) => {
  switch (data.type) {
    case 'bounds':
      bounds = { z0: 0, z1: 0, ...data.bounds };
      half = data.half;
      count = data.count;
      x = new Float32Array(count);
      y = new Float32Array(count);
      z = new Float32Array(count);
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
      vortices = data.vortices;
      if (field && !spawned) spawnAll();
      break;
    case 'step': {
      const ready = !!field && !!flow && data.count === count;
      const k = ready ? step(data.buffer, data.dt, data.time, data.speed) : 0;
      const reply: FromParticleWorker = { buffer: data.buffer, count: data.count, k, ready };
      scope.postMessage(reply, { transfer: [data.buffer] });
      break;
    }
  }
};
