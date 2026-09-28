// Layout of the buffer the particle worker fills, and the messages exchanged with it.
import type { Flow, FlowField, TipVortices, Wake } from './aero';

/** World box the particles live in; z only in 3D. */
export interface Bounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0?: number;
  z1?: number;
}

export interface FrameArrays {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  u: Float32Array;
  v: Float32Array;
  w: Float32Array;
  /** Speed colour index, 255 for a particle that just respawned and must not be drawn. */
  bucket: Uint8Array;
}

/** One frame of particles: each moved by (u, v, w) · k during it. z and w stay 0 in 2D. */
export interface Frame extends FrameArrays {
  count: number;
  k: number;
}

export type ToParticleWorker =
  | { type: 'bounds'; bounds: Bounds; count: number; half: number }
  | { type: 'field'; field: FlowField }
  | { type: 'flow'; flow: Flow; wake: Wake | null; vortices: TipVortices | null }
  | { type: 'step'; buffer: ArrayBuffer; count: number; dt: number; time: number; speed: number };

export interface FromParticleWorker {
  buffer: ArrayBuffer;
  count: number;
  k: number;
  ready: boolean;
}

export const SPEED_BUCKETS = [0.6, 0.85, 0.95, 1.05, 1.2, 1.45, Infinity];
export const SPEED_COLORS = ['#f97316', '#fdba74', '#f1e4d4', '#e2e8f0', '#bae6fd', '#7dd3fc', '#0ea5e9'];

export const byteSize = (count: number) => count * 25;

/** Views over the shared buffer: six Float32 arrays then one Uint8 array. */
export function layout(buffer: ArrayBuffer, count: number): FrameArrays {
  return {
    x: new Float32Array(buffer, 0, count),
    y: new Float32Array(buffer, count * 4, count),
    z: new Float32Array(buffer, count * 8, count),
    u: new Float32Array(buffer, count * 12, count),
    v: new Float32Array(buffer, count * 16, count),
    w: new Float32Array(buffer, count * 20, count),
    bucket: new Uint8Array(buffer, count * 24, count),
  };
}
